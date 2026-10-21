from __future__ import annotations

import re
from datetime import date
from uuid import UUID

from sqlalchemy import case, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.context import request_id_var
from app.core.errors import AppError
from app.modules.audit.service import AuditService
from app.modules.identity.service import AuthContext
from app.modules.patients.models import NumberCounter, Patient
from app.modules.patients.phone import normalize_indian_mobile, try_normalize_indian_mobile
from app.modules.patients.schemas import (
    DuplicatePatientCandidate,
    PatientCreateRequest,
    PatientListResponse,
    PatientResponse,
    PatientTimelineResponse,
    PatientUpdateRequest,
)

_LEGACY_PATIENT_CODE = re.compile(r"^PT-(\d+)$", re.IGNORECASE)


class PatientService:
    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def search(self, *, query: str, limit: int, offset: int) -> PatientListResponse:
        cleaned = query.strip()
        if not cleaned:
            return PatientListResponse(items=[], total=0, limit=limit, offset=offset)

        phone = try_normalize_indian_mobile(cleaned)
        code_candidate = _patient_code_search_candidate(cleaned)
        like = f"%{cleaned}%"
        criteria = [Patient.full_name.ilike(like)]
        if code_candidate:
            criteria.insert(0, Patient.patient_code == code_candidate)
        if cleaned != code_candidate:
            criteria.append(Patient.patient_code == cleaned)
        if phone:
            criteria.insert(0, Patient.mobile_e164 == phone)

        ranking_whens = []
        if phone:
            ranking_whens.append((Patient.mobile_e164 == phone, 0))
        if code_candidate:
            ranking_whens.append((Patient.patient_code == code_candidate, 1))
        else:
            ranking_whens.append((func.lower(Patient.patient_code) == cleaned.lower(), 1))
        ranking = case(*ranking_whens, else_=2)
        base = select(Patient).where(
            Patient.clinic_id == self.context.clinic_id,
            or_(*criteria),
        )
        total = self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = self.db.scalars(
            base.order_by(ranking, Patient.full_name, Patient.patient_code).limit(limit).offset(offset)
        ).all()
        return PatientListResponse(
            items=[self._response(patient) for patient in rows],
            total=total,
            limit=limit,
            offset=offset,
        )

    def get(self, patient_id: UUID) -> PatientResponse:
        patient = self._get_patient(patient_id)
        return self._response(patient)

    def timeline(self, patient_id: UUID) -> PatientTimelineResponse:
        # Appointment/Visit/Follow-up entries are populated by their modules as
        # those milestones land. Keeping this endpoint stable now lets the mobile
        # Patient Profile integrate once and grow without route churn.
        return PatientTimelineResponse(patient=self.get(patient_id), entries=[])

    def create(self, request: PatientCreateRequest) -> PatientResponse:
        full_name = _clean_name(request.full_name)
        mobile = normalize_indian_mobile(request.mobile_number) if request.mobile_number else None
        whatsapp_same_as_mobile = bool(request.whatsapp_same_as_mobile and mobile)
        whatsapp = (
            mobile
            if whatsapp_same_as_mobile
            else normalize_indian_mobile(request.whatsapp_number)
            if request.whatsapp_number
            else None
        )

        if mobile:
            duplicates = self._mobile_duplicates(mobile)
            if duplicates and not request.allow_shared_mobile:
                self._raise_duplicate(duplicates)

        today = self.clock.clinic_date()
        if request.date_of_birth is not None and request.date_of_birth > today:
            raise AppError(
                code="INVALID_DATE_OF_BIRTH",
                message="Date of birth cannot be in the future.",
                status_code=422,
            )

        patient = Patient(
            clinic_id=self.context.clinic_id,
            patient_code=self._next_patient_code(),
            full_name=full_name,
            mobile_e164=mobile,
            whatsapp_e164=whatsapp,
            whatsapp_same_as_mobile=whatsapp_same_as_mobile,
            date_of_birth=request.date_of_birth,
            approximate_age_years=request.approximate_age_years,
            age_as_of_date=today if request.approximate_age_years is not None else None,
            gender=request.gender,
            preferred_language=request.preferred_language,
            reminders_enabled=bool(request.reminders_enabled and whatsapp),
            created_by=self.context.user_id,
            version=1,
        )
        self.db.add(patient)
        self.db.flush()

        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="PATIENT_CREATED",
            entity_type="PATIENT",
            entity_id=patient.patient_id,
            request_id=_request_id(),
            new_values=self._audit_values(patient),
        )
        return self._response(patient)

    def update(self, patient_id: UUID, request: PatientUpdateRequest) -> PatientResponse:
        patient = self.db.scalar(
            select(Patient)
            .where(
                Patient.patient_id == patient_id,
                Patient.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if patient is None:
            self._not_found()
        if patient.version != request.expected_version:
            raise AppError(
                code="STALE_VERSION",
                message="This patient was changed by another user. Reload and try again.",
                status_code=409,
                details={"current_version": patient.version},
            )

        previous = self._audit_values(patient)
        changed = request.model_fields_set

        if "full_name" in changed and request.full_name is not None:
            patient.full_name = _clean_name(request.full_name)

        mobile_changed = "mobile_number" in changed
        if mobile_changed:
            new_mobile = (
                normalize_indian_mobile(request.mobile_number) if request.mobile_number else None
            )
            if new_mobile:
                duplicates = self._mobile_duplicates(
                    new_mobile, exclude_patient_id=patient.patient_id
                )
                if duplicates and not request.allow_shared_mobile:
                    self._raise_duplicate(duplicates)
            patient.mobile_e164 = new_mobile

        if "whatsapp_same_as_mobile" in changed and request.whatsapp_same_as_mobile is not None:
            patient.whatsapp_same_as_mobile = request.whatsapp_same_as_mobile

        if patient.whatsapp_same_as_mobile:
            if patient.mobile_e164:
                patient.whatsapp_e164 = patient.mobile_e164
            else:
                patient.whatsapp_same_as_mobile = False
                patient.whatsapp_e164 = None
        elif "whatsapp_number" in changed:
            patient.whatsapp_e164 = (
                normalize_indian_mobile(request.whatsapp_number)
                if request.whatsapp_number
                else None
            )

        dob_touched = "date_of_birth" in changed
        approx_touched = "approximate_age_years" in changed
        if dob_touched:
            patient.date_of_birth = request.date_of_birth
        if approx_touched:
            patient.approximate_age_years = request.approximate_age_years
            patient.age_as_of_date = (
                self.clock.clinic_date() if request.approximate_age_years is not None else None
            )

        if dob_touched and request.date_of_birth is not None and not approx_touched:
            patient.approximate_age_years = None
            patient.age_as_of_date = None
        if approx_touched and request.approximate_age_years is not None and not dob_touched:
            patient.date_of_birth = None

        if (patient.date_of_birth is None) == (patient.approximate_age_years is None):
            raise AppError(
                code="DOB_OR_AGE_REQUIRED",
                message="Provide either date of birth or approximate age, not both.",
                status_code=422,
            )
        if patient.date_of_birth is not None and patient.date_of_birth > self.clock.clinic_date():
            raise AppError(
                code="INVALID_DATE_OF_BIRTH",
                message="Date of birth cannot be in the future.",
                status_code=422,
            )

        if "gender" in changed and request.gender is not None:
            patient.gender = request.gender
        if "preferred_language" in changed and request.preferred_language is not None:
            patient.preferred_language = request.preferred_language
        if "reminders_enabled" in changed and request.reminders_enabled is not None:
            patient.reminders_enabled = bool(request.reminders_enabled and patient.whatsapp_e164)
        elif not patient.whatsapp_e164:
            patient.reminders_enabled = False

        patient.version += 1
        self.db.flush()
        current = self._audit_values(patient)
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="PATIENT_UPDATED",
            entity_type="PATIENT",
            entity_id=patient.patient_id,
            request_id=_request_id(),
            previous_values=previous,
            new_values=current,
        )
        return self._response(patient)

    def _next_patient_code(self) -> str:
        key = "PATIENT"
        self.db.execute(
            pg_insert(NumberCounter)
            .values(clinic_id=self.context.clinic_id, counter_key=key, last_value=0)
            .on_conflict_do_nothing(index_elements=["clinic_id", "counter_key"])
        )
        counter = self.db.scalar(
            select(NumberCounter)
            .where(
                NumberCounter.clinic_id == self.context.clinic_id,
                NumberCounter.counter_key == key,
            )
            .with_for_update()
        )
        if counter is None:  # pragma: no cover - defensive DB invariant
            raise RuntimeError("Patient number counter could not be initialized")
        counter.last_value += 1
        self.db.flush()
        return _format_patient_code(counter.last_value)

    def _mobile_duplicates(
        self, mobile: str, *, exclude_patient_id: UUID | None = None
    ) -> list[Patient]:
        query = select(Patient).where(
            Patient.clinic_id == self.context.clinic_id,
            Patient.mobile_e164 == mobile,
        )
        if exclude_patient_id is not None:
            query = query.where(Patient.patient_id != exclude_patient_id)
        return list(self.db.scalars(query.order_by(Patient.full_name)).all())

    def _raise_duplicate(self, patients: list[Patient]) -> None:
        candidates = [
            DuplicatePatientCandidate(
                patient_id=item.patient_id,
                patient_code=item.patient_code,
                full_name=item.full_name,
                mobile_number=item.mobile_e164 or "",
                gender=item.gender,
                age=self._age(item),
            ).model_dump(mode="json")
            for item in patients
        ]
        raise AppError(
            code="POTENTIAL_DUPLICATE_PATIENT",
            message="A patient with this mobile number already exists.",
            status_code=409,
            details={"candidates": candidates},
        )

    def _get_patient(self, patient_id: UUID) -> Patient:
        patient = self.db.scalar(
            select(Patient).where(
                Patient.patient_id == patient_id,
                Patient.clinic_id == self.context.clinic_id,
            )
        )
        if patient is None:
            self._not_found()
        return patient

    def _response(self, patient: Patient) -> PatientResponse:
        return PatientResponse(
            patient_id=patient.patient_id,
            patient_code=patient.patient_code,
            full_name=patient.full_name,
            mobile_number=patient.mobile_e164 or "",
            whatsapp_number=patient.whatsapp_e164 or "",
            whatsapp_same_as_mobile=patient.whatsapp_same_as_mobile,
            date_of_birth=patient.date_of_birth,
            approximate_age_years=patient.approximate_age_years,
            age_as_of_date=patient.age_as_of_date,
            age=self._age(patient),
            gender=patient.gender,
            preferred_language=patient.preferred_language,
            reminders_enabled=patient.reminders_enabled,
            version=patient.version,
            created_at=patient.created_at,
            updated_at=patient.updated_at,
        )

    def _age(self, patient: Patient) -> int:
        today = self.clock.clinic_date()
        if patient.date_of_birth is not None:
            return _age_from_dob(patient.date_of_birth, today)
        if patient.approximate_age_years is not None and patient.age_as_of_date is not None:
            elapsed = _whole_years(patient.age_as_of_date, today)
            return min(130, patient.approximate_age_years + elapsed)
        return 0

    @staticmethod
    def _audit_values(patient: Patient) -> dict[str, object]:
        return {
            "patient_code": patient.patient_code,
            "full_name": patient.full_name,
            "mobile_e164": patient.mobile_e164,
            "whatsapp_e164": patient.whatsapp_e164,
            "whatsapp_same_as_mobile": patient.whatsapp_same_as_mobile,
            "date_of_birth": patient.date_of_birth.isoformat() if patient.date_of_birth else None,
            "approximate_age_years": patient.approximate_age_years,
            "age_as_of_date": patient.age_as_of_date.isoformat() if patient.age_as_of_date else None,
            "gender": patient.gender,
            "preferred_language": patient.preferred_language,
            "reminders_enabled": patient.reminders_enabled,
            "version": patient.version,
        }

    @staticmethod
    def _not_found() -> None:
        raise AppError(
            code="PATIENT_NOT_FOUND",
            message="Patient not found.",
            status_code=404,
        )


def _format_patient_code(value: int) -> str:
    if value < 1:
        raise ValueError("Patient number must be positive.")
    return f"{value:04d}"


def _patient_code_search_candidate(value: str) -> str | None:
    cleaned = value.strip()
    legacy_match = _LEGACY_PATIENT_CODE.fullmatch(cleaned)
    digits = legacy_match.group(1) if legacy_match else cleaned if cleaned.isdigit() else None
    if digits is None:
        return None
    number = int(digits)
    return _format_patient_code(number) if number > 0 else None


def _clean_name(value: str) -> str:
    cleaned = " ".join(value.split())
    if not cleaned:
        raise AppError(
            code="INVALID_PATIENT_NAME",
            message="Enter the patient's full name.",
            status_code=422,
        )
    return cleaned


def _whole_years(start: date, end: date) -> int:
    return end.year - start.year - ((end.month, end.day) < (start.month, start.day))


def _age_from_dob(dob: date, today: date) -> int:
    return max(0, _whole_years(dob, today))


def _request_id() -> UUID:
    raw = request_id_var.get()
    if raw is None:  # pragma: no cover - middleware invariant for HTTP commands
        raise RuntimeError("Request ID is missing")
    return UUID(raw)
