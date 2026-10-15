from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.context import request_id_var
from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.appointments.service import AppointmentService
from app.modules.audit.service import AuditService
from app.modules.followups.models import FollowUpRecommendation
from app.modules.followups.schemas import (
    FollowUpBookRequest,
    FollowUpBookResponse,
    FollowUpCloseRequest,
    FollowUpLinkedAppointmentSummary,
    FollowUpListResponse,
    FollowUpPatientSummary,
    FollowUpResponse,
)
from app.modules.idempotency.models import IdempotencyRecord
from app.modules.idempotency.service import IdempotencyService
from app.modules.identity.service import AuthContext
from app.modules.messaging.service import ReminderService
from app.modules.patients.models import Patient
from app.modules.scheduling.concurrency import acquire_doctor_date_locks
from app.modules.scheduling.models import SessionOccurrence
from app.modules.scheduling.service import SchedulingService
from app.modules.visits.models import Visit


def _request_id() -> UUID:
    value = request_id_var.get()
    if value is None:  # pragma: no cover
        raise RuntimeError("request id missing")
    return UUID(value)


class FollowUpService:
    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def list(
        self,
        *,
        state: str | None = None,
        patient_id: UUID | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> FollowUpListResponse:
        today = self.clock.clinic_date()
        conditions = [FollowUpRecommendation.clinic_id == self.context.clinic_id]
        normalized = state.upper() if state else None
        if normalized:
            if normalized == "DUE_TODAY":
                conditions += [
                    FollowUpRecommendation.status == "OPEN",
                    FollowUpRecommendation.due_date == today,
                ]
            elif normalized == "UPCOMING":
                conditions += [
                    FollowUpRecommendation.status == "OPEN",
                    FollowUpRecommendation.due_date > today,
                ]
            elif normalized == "OVERDUE":
                conditions += [
                    FollowUpRecommendation.status == "OPEN",
                    FollowUpRecommendation.due_date < today,
                ]
            elif normalized in {"OPEN", "BOOKED", "CLOSED"}:
                conditions.append(FollowUpRecommendation.status == normalized)
            else:
                raise AppError("INVALID_FOLLOWUP_FILTER", "Invalid follow-up filter.", 422)
        if patient_id:
            conditions.append(FollowUpRecommendation.patient_id == patient_id)

        rows = self.db.scalars(
            select(FollowUpRecommendation)
            .where(*conditions)
            .order_by(FollowUpRecommendation.due_date.asc(), FollowUpRecommendation.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        total = int(
            self.db.scalar(select(func.count(FollowUpRecommendation.followup_id)).where(*conditions))
            or 0
        )
        return FollowUpListResponse(
            items=[self._response(row) for row in rows], total=total, limit=limit, offset=offset
        )

    def get(self, followup_id: UUID) -> FollowUpResponse:
        return self._response(self._followup(followup_id))

    def book(
        self,
        followup_id: UUID,
        request: FollowUpBookRequest,
        *,
        idempotency_key: str,
    ) -> FollowUpBookResponse:
        payload_hash = IdempotencyService.request_hash(
            {"followup_id": str(followup_id), **request.model_dump(mode="json")}
        )
        record = self._reserve_idempotency("FOLLOWUP_BOOK", idempotency_key, payload_hash)
        if record.response_body is not None:
            return FollowUpBookResponse.model_validate(record.response_body)

        # Discover immutable ownership without holding FollowUp while waiting for date/Patient.
        followup = self._followup(followup_id)
        if request.appointment_date < self.clock.clinic_date():
            raise AppError("APPOINTMENT_DATE_PAST", "Select today or a future date.", 422)

        source_visit = self.db.scalar(
            select(Visit).where(
                Visit.visit_id == followup.source_visit_id,
                Visit.clinic_id == self.context.clinic_id,
            )
        )
        if source_visit is None:
            raise RuntimeError("Follow-up source visit integrity failure")

        appt_service = AppointmentService(self.db, self.clock, self.context)
        acquire_doctor_date_locks(self.db, source_visit.doctor_id, [request.appointment_date])
        appt_service._lock_patient(followup.patient_id)
        followup = self._locked_followup(followup_id)
        if followup.status != "OPEN":
            raise AppError("FOLLOWUP_INVALID_STATE", "Only an open follow-up can be booked.", 409)
        appt_service._validate_no_duplicate_appointment(
            patient_id=followup.patient_id,
            doctor_id=source_visit.doctor_id,
            appointment_date=request.appointment_date,
        )
        occurrence = SchedulingService(self.db, self.clock, self.context).materialize_occurrence(
            request.session_definition_id, request.appointment_date, doctor_id=source_visit.doctor_id
        )
        occurrence = appt_service._lock_occurrence(occurrence.session_occurrence_id)
        appt_service._validate_occurrence_doctor(occurrence, source_visit.doctor_id)
        appt_service._validate_booking_time(occurrence, request.appointment_time)
        if occurrence.status == "BLOCKED":
            raise AppError("SESSION_BLOCKED", "This session is unavailable for booking.", 409)

        used_capacity, slot_taken = appt_service._availability_state(
            occurrence, request.appointment_time
        )
        needs_override = used_capacity >= occurrence.maximum_capacity_snapshot or slot_taken
        override = appt_service._authorize_override(
            request.capacity_override,
            needs_override=needs_override,
            occurrence=occurrence,
            used_capacity=used_capacity,
            appointment_time=request.appointment_time,
        )
        if used_capacity >= occurrence.maximum_capacity_snapshot and not override:
            raise AppError("SESSION_FULL", "This session is already full.", 409)
        if slot_taken and not override:
            raise AppError(
                "APPOINTMENT_SLOT_UNAVAILABLE",
                "This appointment time is no longer available. Please select another time.",
                409,
            )

        fee = appt_service._fee_for_type("FOLLOW_UP")
        now = self.clock.now_utc()
        appointment = Appointment(
            clinic_id=self.context.clinic_id,
            patient_id=followup.patient_id,
            doctor_id=source_visit.doctor_id,
            session_occurrence_id=occurrence.session_occurrence_id,
            appointment_time=request.appointment_time,
            appointment_type="FOLLOW_UP",
            booking_source=appt_service._booking_source(),
            status="BOOKED",
            base_fee_snapshot=fee,
            effective_fee_amount=fee,
            created_by=self.context.user_id,
            capacity_override_used=override,
            capacity_override_by=self.context.user_id if override else None,
            capacity_override_at=now if override else None,
            capacity_override_reason=(
                request.capacity_override.reason.strip()
                if override and request.capacity_override
                else None
            ),
            override_capacity_snapshot=(occurrence.maximum_capacity_snapshot if override else None),
            override_existing_count=(used_capacity if override else None),
        )
        self.db.add(appointment)
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise AppError(
                "APPOINTMENT_SLOT_UNAVAILABLE",
                "This appointment time is no longer available. Please select another time.",
                409,
            ) from exc

        followup.status = "BOOKED"
        followup.linked_appointment_id = appointment.appointment_id
        followup.version += 1
        appt_service._audit_created(appointment, occurrence, used_capacity)
        reminder_service = ReminderService(self.db, self.clock, self.context)
        reminder_service.skip_followup_reminder(followup.followup_id, "FOLLOWUP_BOOKED")
        reminder_service.ensure_appointment_reminder(appointment, occurrence)
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="FOLLOWUP_BOOKED",
            entity_type="FOLLOWUP",
            entity_id=followup.followup_id,
            request_id=_request_id(),
            previous_values={"status": "OPEN", "linked_appointment_id": None},
            new_values={
                "status": "BOOKED",
                "linked_appointment_id": str(appointment.appointment_id),
            },
        )
        self.db.flush()

        response = FollowUpBookResponse(
            followup=self._response(followup),
            appointment=appt_service._response(appointment),
        )
        self._complete_idempotency(record, response, appointment.appointment_id)
        return response

    def close(self, followup_id: UUID, request: FollowUpCloseRequest) -> FollowUpResponse:
        followup = self._locked_followup(followup_id)
        if followup.status != "OPEN":
            raise AppError(
                "FOLLOWUP_INVALID_STATE",
                "Only an open follow-up without a booked appointment can be closed manually.",
                409,
            )
        now = self.clock.now_utc()
        reason = request.reason
        if request.note:
            reason = f"{reason}: {request.note.strip()}"
        followup.status = "CLOSED"
        followup.closed_by = self.context.user_id
        followup.closed_at = now
        followup.close_reason = reason
        followup.version += 1
        ReminderService(self.db, self.clock, self.context).skip_followup_reminder(
            followup.followup_id, "FOLLOWUP_CLOSED"
        )
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="FOLLOWUP_CLOSED",
            entity_type="FOLLOWUP",
            entity_id=followup.followup_id,
            request_id=_request_id(),
            reason=reason,
            previous_values={"status": "OPEN"},
            new_values={"status": "CLOSED"},
        )
        return self._response(followup)

    def _followup(self, followup_id: UUID) -> FollowUpRecommendation:
        item = self.db.scalar(
            select(FollowUpRecommendation).where(
                FollowUpRecommendation.followup_id == followup_id,
                FollowUpRecommendation.clinic_id == self.context.clinic_id,
            )
        )
        if item is None:
            raise AppError("FOLLOWUP_NOT_FOUND", "Follow-up not found.", 404)
        return item

    def _locked_followup(self, followup_id: UUID) -> FollowUpRecommendation:
        item = self.db.scalar(
            select(FollowUpRecommendation)
            .where(
                FollowUpRecommendation.followup_id == followup_id,
                FollowUpRecommendation.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if item is None:
            raise AppError("FOLLOWUP_NOT_FOUND", "Follow-up not found.", 404)
        return item

    def _response(self, item: FollowUpRecommendation) -> FollowUpResponse:
        patient = self.db.get(Patient, item.patient_id)
        source_visit = self.db.get(Visit, item.source_visit_id)
        if patient is None or source_visit is None:
            raise RuntimeError("Follow-up reference integrity failure")
        source_appt = self.db.get(Appointment, source_visit.appointment_id)
        if source_appt is None:
            raise RuntimeError("Follow-up source appointment integrity failure")
        source_occurrence = self.db.get(SessionOccurrence, source_appt.session_occurrence_id)
        if source_occurrence is None:
            raise RuntimeError("Follow-up source occurrence integrity failure")

        linked: FollowUpLinkedAppointmentSummary | None = None
        if item.linked_appointment_id:
            linked_appt = self.db.get(Appointment, item.linked_appointment_id)
            if linked_appt is None:
                raise RuntimeError("Follow-up linked appointment integrity failure")
            linked_occurrence = self.db.get(SessionOccurrence, linked_appt.session_occurrence_id)
            if linked_occurrence is None:
                raise RuntimeError("Follow-up linked occurrence integrity failure")
            linked = FollowUpLinkedAppointmentSummary(
                appointment_id=linked_appt.appointment_id,
                date=linked_occurrence.occurrence_date,
                time=linked_appt.appointment_time,
                status=linked_appt.status,
            )

        return FollowUpResponse(
            followup_id=item.followup_id,
            patient=FollowUpPatientSummary(
                patient_id=patient.patient_id,
                patient_code=patient.patient_code,
                full_name=patient.full_name,
                mobile_number=patient.mobile_e164,
            ),
            source_visit_id=item.source_visit_id,
            source_visit_date=source_occurrence.occurrence_date,
            doctor_id=source_visit.doctor_id,
            due_date=item.due_date,
            interval_days=item.interval_days,
            status=item.status,
            overdue=item.status == "OPEN" and item.due_date < self.clock.clinic_date(),
            linked_appointment=linked,
            close_reason=item.close_reason,
            version=item.version,
            created_at=item.created_at,
            closed_at=item.closed_at,
        )

    def _reserve_idempotency(
        self, operation: str, key: str, request_hash: str
    ) -> IdempotencyRecord:
        if not key or len(key) > 128:
            raise AppError("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required.", 422)
        return IdempotencyService(self.db, self.clock).reserve(
            clinic_id=self.context.clinic_id,
            user_id=self.context.user_id,
            operation=operation,
            key=key,
            request_hash=request_hash,
        )

    def _complete_idempotency(
        self, record: IdempotencyRecord, response: FollowUpBookResponse, resource_id: UUID
    ) -> None:
        record.response_status = 200
        record.response_body = response.model_dump(mode="json")
        record.resource_type = "APPOINTMENT"
        record.resource_id = resource_id
        self.db.flush()
