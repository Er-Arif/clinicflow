from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.context import request_id_var
from app.core.errors import AppError
from app.modules.audit.service import AuditService
from app.modules.clinic.models import Clinic, Doctor
from app.modules.clinic.schemas import (
    ClinicSettingsResponse,
    ClinicSettingsUpdateRequest,
    DoctorSettingsResponse,
    DoctorSettingsUpdateRequest,
)
from app.modules.identity.service import AuthContext


def _request_id() -> UUID:
    value = request_id_var.get()
    if value is None:
        raise RuntimeError("Request ID is unavailable")
    return UUID(value)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.strip().split())
    return cleaned or None


class ClinicSettingsService:
    def __init__(self, db: Session, context: AuthContext):
        self.db = db
        self.context = context

    def get_clinic(self) -> ClinicSettingsResponse:
        clinic = self._clinic()
        return self._clinic_response(clinic)

    def update_clinic(self, request: ClinicSettingsUpdateRequest) -> ClinicSettingsResponse:
        clinic = self.db.scalar(
            select(Clinic)
            .where(Clinic.clinic_id == self.context.clinic_id)
            .with_for_update()
        )
        if clinic is None:
            raise AppError("CLINIC_NOT_FOUND", "Clinic configuration was not found.", 404)
        if clinic.version != request.expected_version:
            raise AppError(
                "STALE_VERSION",
                "Clinic settings were changed by another user. Reload and try again.",
                409,
                {"current_version": clinic.version},
            )
        previous = self._clinic_audit(clinic)
        if "clinic_name" in request.model_fields_set and request.clinic_name is not None:
            name = _clean(request.clinic_name)
            if not name:
                raise AppError("VALIDATION_ERROR", "Clinic name is required.", 422)
            clinic.clinic_name = name
        if "address" in request.model_fields_set:
            clinic.address = _clean(request.address)
        if "contact_number" in request.model_fields_set:
            clinic.contact_number = _clean(request.contact_number)
        clinic.version += 1
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="CLINIC_SETTINGS_CHANGED",
            entity_type="CLINIC",
            entity_id=clinic.clinic_id,
            request_id=_request_id(),
            previous_values=previous,
            new_values=self._clinic_audit(clinic),
        )
        return self._clinic_response(clinic)

    def get_doctor(self, doctor_id: UUID) -> DoctorSettingsResponse:
        return self._doctor_response(self._doctor(doctor_id))

    def update_doctor(
        self, doctor_id: UUID, request: DoctorSettingsUpdateRequest
    ) -> DoctorSettingsResponse:
        doctor = self.db.scalar(
            select(Doctor)
            .where(Doctor.doctor_id == doctor_id, Doctor.clinic_id == self.context.clinic_id)
            .with_for_update()
        )
        if doctor is None:
            raise AppError("DOCTOR_NOT_FOUND", "Doctor was not found.", 404)
        if doctor.version != request.expected_version:
            raise AppError(
                "STALE_VERSION",
                "Doctor settings were changed by another user. Reload and try again.",
                409,
                {"current_version": doctor.version},
            )
        previous = self._doctor_audit(doctor)
        if "display_name" in request.model_fields_set and request.display_name is not None:
            name = _clean(request.display_name)
            if not name:
                raise AppError("VALIDATION_ERROR", "Doctor name is required.", 422)
            doctor.display_name = name
        if "professional_display_details" in request.model_fields_set:
            doctor.professional_display_details = _clean(request.professional_display_details)
        doctor.version += 1
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="DOCTOR_SETTINGS_CHANGED",
            entity_type="DOCTOR",
            entity_id=doctor.doctor_id,
            request_id=_request_id(),
            previous_values=previous,
            new_values=self._doctor_audit(doctor),
        )
        return self._doctor_response(doctor)

    def _clinic(self) -> Clinic:
        clinic = self.db.get(Clinic, self.context.clinic_id)
        if clinic is None:
            raise AppError("CLINIC_NOT_FOUND", "Clinic configuration was not found.", 404)
        return clinic

    def _doctor(self, doctor_id: UUID) -> Doctor:
        doctor = self.db.scalar(
            select(Doctor).where(
                Doctor.doctor_id == doctor_id,
                Doctor.clinic_id == self.context.clinic_id,
            )
        )
        if doctor is None:
            raise AppError("DOCTOR_NOT_FOUND", "Doctor was not found.", 404)
        return doctor

    @staticmethod
    def _clinic_response(clinic: Clinic) -> ClinicSettingsResponse:
        return ClinicSettingsResponse(
            clinic_id=clinic.clinic_id,
            clinic_name=clinic.clinic_name,
            address=clinic.address,
            contact_number=clinic.contact_number,
            version=clinic.version,
        )

    @staticmethod
    def _doctor_response(doctor: Doctor) -> DoctorSettingsResponse:
        return DoctorSettingsResponse(
            doctor_id=doctor.doctor_id,
            user_id=doctor.user_id,
            display_name=doctor.display_name,
            professional_display_details=doctor.professional_display_details,
            active=doctor.active,
            version=doctor.version,
        )

    @staticmethod
    def _clinic_audit(clinic: Clinic) -> dict[str, object]:
        return {
            "clinic_name": clinic.clinic_name,
            "address": clinic.address,
            "contact_number": clinic.contact_number,
            "version": clinic.version,
        }

    @staticmethod
    def _doctor_audit(doctor: Doctor) -> dict[str, object]:
        return {
            "display_name": doctor.display_name,
            "professional_display_details": doctor.professional_display_details,
            "active": doctor.active,
            "version": doctor.version,
        }
