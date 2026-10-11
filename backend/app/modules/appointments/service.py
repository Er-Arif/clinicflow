from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.context import request_id_var
from app.core.errors import AppError
from app.modules.appointments.models import Appointment, AppointmentFeeAdjustment
from app.modules.appointments.schemas import (
    AppointmentAdjustFeeRequest,
    AppointmentCancelRequest,
    AppointmentCreateRequest,
    AppointmentDoctorSummary,
    AppointmentListResponse,
    AppointmentPatientSummary,
    AppointmentRescheduleRequest,
    AppointmentRescheduleResponse,
    AppointmentResponse,
    AppointmentSessionSummary,
    CapacityOverrideInput,
)
from app.modules.audit.service import AuditService
from app.modules.clinic.models import Doctor
from app.modules.followups.models import FollowUpRecommendation
from app.modules.idempotency.models import IdempotencyRecord
from app.modules.idempotency.service import IdempotencyService
from app.modules.identity.service import AuthContext
from app.modules.messaging.service import ReminderService
from app.modules.patients.models import Patient
from app.modules.payments.models import Payment
from app.modules.scheduling.models import FeeConfiguration, SessionOccurrence
from app.modules.scheduling.service import SchedulingService, generate_slots
from app.modules.visits.models import Visit


def _request_id() -> UUID:
    value = request_id_var.get()
    if value is None:  # pragma: no cover - middleware invariant
        raise RuntimeError("request id missing")
    return UUID(value)


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"))


class AppointmentService:
    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def list(
        self,
        *,
        target_date: date | None,
        patient_id: UUID | None,
        doctor_id: UUID | None,
        status: str | None,
        limit: int,
        offset: int,
    ) -> AppointmentListResponse:
        query = (
            select(Appointment)
            .join(
                SessionOccurrence,
                SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id,
            )
            .where(Appointment.clinic_id == self.context.clinic_id)
        )
        count_query = (
            select(func.count(Appointment.appointment_id))
            .join(
                SessionOccurrence,
                SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id,
            )
            .where(Appointment.clinic_id == self.context.clinic_id)
        )
        filters = []
        if target_date is not None:
            filters.append(SessionOccurrence.occurrence_date == target_date)
        if patient_id is not None:
            filters.append(Appointment.patient_id == patient_id)
        if doctor_id is not None:
            filters.append(Appointment.doctor_id == doctor_id)
        if status is not None:
            status = status.upper()
            if status not in {"BOOKED", "CHECKED_IN", "COMPLETED", "CANCELLED"}:
                raise AppError("INVALID_APPOINTMENT_STATUS", "Invalid appointment status.", 422)
            filters.append(Appointment.status == status)
        if filters:
            query = query.where(*filters)
            count_query = count_query.where(*filters)
        items = self.db.scalars(
            query.order_by(
                SessionOccurrence.occurrence_date.desc(),
                Appointment.appointment_time.asc().nulls_last(),
                Appointment.created_at.desc(),
            ).limit(limit).offset(offset)
        ).all()
        total = int(self.db.scalar(count_query) or 0)
        return AppointmentListResponse(
            items=[self._response(item) for item in items], total=total, limit=limit, offset=offset
        )

    def get(self, appointment_id: UUID) -> AppointmentResponse:
        return self._response(self._appointment(appointment_id))

    def create(
        self, request: AppointmentCreateRequest, *, idempotency_key: str
    ) -> AppointmentResponse:
        payload_hash = IdempotencyService.request_hash(request.model_dump(mode="json"))
        record = self._reserve_idempotency("APPOINTMENT_CREATE", idempotency_key, payload_hash)
        replay = self._replay_appointment(record)
        if replay is not None:
            return replay

        if request.appointment_date < self.clock.clinic_date():
            raise AppError(
                "APPOINTMENT_DATE_PAST",
                "Appointments cannot be booked for a past date.",
                422,
            )

        patient = self._lock_patient(request.patient_id)
        doctor = self._doctor(request.doctor_id)
        self._validate_no_duplicate_appointment(
            patient_id=patient.patient_id,
            doctor_id=doctor.doctor_id,
            appointment_date=request.appointment_date,
        )

        occurrence = SchedulingService(self.db, self.clock, self.context).materialize_occurrence(
            request.session_definition_id, request.appointment_date
        )
        occurrence = self._lock_occurrence(occurrence.session_occurrence_id)
        self._validate_occurrence_doctor(occurrence, doctor.doctor_id)
        used_capacity, slot_taken = self._availability_state(
            occurrence, request.appointment_time
        )
        if occurrence.status == "BLOCKED":
            raise AppError("SESSION_BLOCKED", "This session is unavailable for booking.", 409)
        needs_override = used_capacity >= occurrence.maximum_capacity_snapshot or slot_taken
        self._validate_booking_time(occurrence, request.appointment_time)
        override = self._authorize_override(
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

        base_fee = self._fee_for_type(request.appointment_type)
        effective_fee = base_fee
        adjustment = request.fee_adjustment
        if adjustment is not None:
            self._require_fee_adjustment_allowed()
            effective_fee = _money(adjustment.amount)

        now = self.clock.now_utc()
        appointment = Appointment(
            clinic_id=self.context.clinic_id,
            patient_id=patient.patient_id,
            doctor_id=doctor.doctor_id,
            session_occurrence_id=occurrence.session_occurrence_id,
            appointment_time=request.appointment_time,
            appointment_type=request.appointment_type,
            booking_source=self._booking_source(),
            status="BOOKED",
            base_fee_snapshot=base_fee,
            effective_fee_amount=effective_fee,
            fee_adjustment_reason=adjustment.reason.strip() if adjustment else None,
            fee_adjusted_by=self.context.user_id if adjustment else None,
            fee_adjusted_at=now if adjustment else None,
            created_by=self.context.user_id,
            capacity_override_used=override,
            capacity_override_by=self.context.user_id if override else None,
            capacity_override_at=now if override else None,
            capacity_override_reason=(
                request.capacity_override.reason.strip() if override and request.capacity_override else None
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
        if adjustment is not None and effective_fee != base_fee:
            self._record_fee_adjustment(
                appointment,
                previous=base_fee,
                new=effective_fee,
                reason=adjustment.reason,
            )
        self._audit_created(appointment, occurrence, used_capacity)
        ReminderService(self.db, self.clock, self.context).ensure_appointment_reminder(appointment, occurrence)
        response = self._response(appointment)
        self._complete_idempotency(record, response, 201, "APPOINTMENT", appointment.appointment_id)
        return response

    def cancel(self, appointment_id: UUID, request: AppointmentCancelRequest) -> AppointmentResponse:
        appointment = self._locked_appointment(appointment_id)
        if appointment.status not in {"BOOKED", "CHECKED_IN"}:
            raise AppError(
                "APPOINTMENT_INVALID_STATE",
                "Only a booked or checked-in appointment can be cancelled.",
                409,
            )
        if appointment.status == "CHECKED_IN" and request.reason == "NO_SHOW":
            raise AppError(
                "INVALID_CANCELLATION_REASON",
                "A checked-in patient cannot be marked as a no-show.",
                422,
            )

        now = self.clock.now_utc()
        previous = {"status": appointment.status, "cancellation_reason": appointment.cancellation_reason}
        if appointment.status == "CHECKED_IN":
            visit, payment = self._locked_visit_payment(appointment.appointment_id)
            if visit.status != "ACTIVE":
                raise AppError("VISIT_INVALID_STATE", "This visit is not active.", 409)
            visit.status = "ABORTED"
            visit.aborted_at = now
            if payment.status == "PENDING":
                payment.status = "CANCELLED"
                payment.cancelled_by = self.context.user_id
                payment.cancelled_at = now
                payment.cancel_reason = "Visit aborted because the checked-in appointment was cancelled."
                AuditService(self.db).record(
                    clinic_id=self.context.clinic_id,
                    actor_type="USER",
                    actor_user_id=self.context.user_id,
                    action_type="PAYMENT_CANCELLED",
                    entity_type="PAYMENT",
                    entity_id=payment.payment_id,
                    request_id=_request_id(),
                    new_values={"status": "CANCELLED"},
                )
            AuditService(self.db).record(
                clinic_id=self.context.clinic_id,
                actor_type="USER",
                actor_user_id=self.context.user_id,
                action_type="VISIT_ABORTED",
                entity_type="VISIT",
                entity_id=visit.visit_id,
                request_id=_request_id(),
                reason=request.note,
                previous_values={"status": "ACTIVE"},
                new_values={"status": "ABORTED"},
            )

        appointment.status = "CANCELLED"
        appointment.cancelled_at = now
        appointment.cancelled_by = self.context.user_id
        appointment.cancellation_reason = request.reason
        appointment.cancellation_note = request.note.strip() if request.note else None
        appointment.version += 1
        self.db.flush()
        self._reopen_linked_followup(appointment)
        ReminderService(self.db, self.clock, self.context).skip_appointment_reminder(
            appointment.appointment_id, "APPOINTMENT_CANCELLED"
        )
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="APPOINTMENT_CANCELLED",
            entity_type="APPOINTMENT",
            entity_id=appointment.appointment_id,
            request_id=_request_id(),
            reason=request.note,
            previous_values=previous,
            new_values={"status": "CANCELLED", "cancellation_reason": request.reason},
        )
        return self._response(appointment)

    def reschedule(
        self,
        appointment_id: UUID,
        request: AppointmentRescheduleRequest,
        *,
        idempotency_key: str,
    ) -> AppointmentRescheduleResponse:
        payload = {"appointment_id": str(appointment_id), **request.model_dump(mode="json")}
        payload_hash = IdempotencyService.request_hash(payload)
        record = self._reserve_idempotency("APPOINTMENT_RESCHEDULE", idempotency_key, payload_hash)
        replay = self._replay_reschedule(record)
        if replay is not None:
            return replay

        original = self._locked_appointment(appointment_id)
        if original.status not in {"BOOKED", "CHECKED_IN"}:
            raise AppError(
                "APPOINTMENT_INVALID_STATE",
                "Only a booked or checked-in appointment can be rescheduled.",
                409,
            )
        checked_in_visit: Visit | None = None
        checked_in_payment: Payment | None = None
        if original.status == "CHECKED_IN":
            checked_in_visit, checked_in_payment = self._locked_visit_payment(original.appointment_id)
            if checked_in_visit.status != "ACTIVE":
                raise AppError("VISIT_INVALID_STATE", "This visit is not active.", 409)
            if checked_in_payment.status != "PENDING":
                raise AppError(
                    "PAYMENT_CORRECTION_REQUIRED",
                    "Correct or void the confirmed payment before rescheduling this checked-in patient.",
                    409,
                )
        if request.new_appointment_date < self.clock.clinic_date():
            raise AppError("APPOINTMENT_DATE_PAST", "Select today or a future date.", 422)

        self._lock_patient(original.patient_id)
        self._validate_no_duplicate_appointment(
            patient_id=original.patient_id,
            doctor_id=original.doctor_id,
            appointment_date=request.new_appointment_date,
            exclude_appointment_id=original.appointment_id,
        )

        target = SchedulingService(self.db, self.clock, self.context).materialize_occurrence(
            request.new_session_definition_id, request.new_appointment_date
        )
        target = self._lock_occurrence(target.session_occurrence_id)
        self._validate_occurrence_doctor(target, original.doctor_id)
        self._validate_booking_time(target, request.new_appointment_time)
        if (
            target.session_occurrence_id == original.session_occurrence_id
            and request.new_appointment_time == original.appointment_time
        ):
            raise AppError(
                "RESCHEDULE_TARGET_UNCHANGED",
                "Choose a different appointment date or time.",
                422,
            )
        used_capacity, slot_taken = self._availability_state(
            target, request.new_appointment_time, exclude_appointment_id=original.appointment_id
        )
        if target.status == "BLOCKED":
            raise AppError("SESSION_BLOCKED", "The new session is unavailable.", 409)
        needs_override = used_capacity >= target.maximum_capacity_snapshot or slot_taken
        override = self._authorize_override(
            request.capacity_override,
            needs_override=needs_override,
            occurrence=target,
            used_capacity=used_capacity,
            appointment_time=request.new_appointment_time,
        )
        if used_capacity >= target.maximum_capacity_snapshot and not override:
            raise AppError("SESSION_FULL", "The new session is already full.", 409)
        if slot_taken and not override:
            raise AppError(
                "APPOINTMENT_SLOT_UNAVAILABLE",
                "The new appointment time is no longer available. Your original appointment has not been changed.",
                409,
            )

        now = self.clock.now_utc()
        replacement = Appointment(
            clinic_id=self.context.clinic_id,
            patient_id=original.patient_id,
            doctor_id=original.doctor_id,
            session_occurrence_id=target.session_occurrence_id,
            appointment_time=request.new_appointment_time,
            appointment_type=original.appointment_type,
            booking_source=self._booking_source(),
            status="BOOKED",
            base_fee_snapshot=original.base_fee_snapshot,
            effective_fee_amount=original.effective_fee_amount,
            fee_adjustment_reason=original.fee_adjustment_reason,
            fee_adjusted_by=original.fee_adjusted_by,
            fee_adjusted_at=original.fee_adjusted_at,
            created_by=self.context.user_id,
            rescheduled_from_appointment_id=original.appointment_id,
            capacity_override_used=override,
            capacity_override_by=self.context.user_id if override else None,
            capacity_override_at=now if override else None,
            capacity_override_reason=(
                request.capacity_override.reason.strip() if override and request.capacity_override else None
            ),
            override_capacity_snapshot=(target.maximum_capacity_snapshot if override else None),
            override_existing_count=(used_capacity if override else None),
        )
        self.db.add(replacement)
        try:
            self.db.flush()
        except IntegrityError as exc:
            raise AppError(
                "APPOINTMENT_SLOT_UNAVAILABLE",
                "The new appointment time is no longer available. Your original appointment has not been changed.",
                409,
            ) from exc
        self._transfer_linked_followup(original, replacement)

        if checked_in_visit is not None and checked_in_payment is not None:
            checked_in_visit.status = "ABORTED"
            checked_in_visit.aborted_at = now
            checked_in_payment.status = "CANCELLED"
            checked_in_payment.cancelled_by = self.context.user_id
            checked_in_payment.cancelled_at = now
            checked_in_payment.cancel_reason = "Visit aborted because the checked-in appointment was rescheduled."
            AuditService(self.db).record(
                clinic_id=self.context.clinic_id,
                actor_type="USER",
                actor_user_id=self.context.user_id,
                action_type="VISIT_ABORTED",
                entity_type="VISIT",
                entity_id=checked_in_visit.visit_id,
                request_id=_request_id(),
                previous_values={"status": "ACTIVE"},
                new_values={"status": "ABORTED", "reason": "RESCHEDULED"},
            )
            AuditService(self.db).record(
                clinic_id=self.context.clinic_id,
                actor_type="USER",
                actor_user_id=self.context.user_id,
                action_type="PAYMENT_CANCELLED",
                entity_type="PAYMENT",
                entity_id=checked_in_payment.payment_id,
                request_id=_request_id(),
                new_values={"status": "CANCELLED", "reason": "RESCHEDULED"},
            )

        original.status = "CANCELLED"
        original.cancelled_at = now
        original.cancelled_by = self.context.user_id
        original.cancellation_reason = "RESCHEDULED"
        original.rescheduled_to_appointment_id = replacement.appointment_id
        original.version += 1
        self.db.flush()
        reminder_service = ReminderService(self.db, self.clock, self.context)
        reminder_service.skip_appointment_reminder(original.appointment_id, "APPOINTMENT_RESCHEDULED")
        reminder_service.ensure_appointment_reminder(replacement, target)
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="APPOINTMENT_RESCHEDULED",
            entity_type="APPOINTMENT",
            entity_id=original.appointment_id,
            request_id=_request_id(),
            previous_values={"status": "BOOKED"},
            new_values={
                "status": "CANCELLED",
                "cancellation_reason": "RESCHEDULED",
                "replacement_appointment_id": str(replacement.appointment_id),
            },
            metadata={
                "target_date": target.occurrence_date.isoformat(),
                "target_time": request.new_appointment_time.isoformat(),
            },
        )
        response = AppointmentRescheduleResponse(
            original=self._response(original), replacement=self._response(replacement)
        )
        self._complete_idempotency(
            record, response, 200, "APPOINTMENT", replacement.appointment_id
        )
        return response

    def adjust_fee(
        self, appointment_id: UUID, request: AppointmentAdjustFeeRequest
    ) -> AppointmentResponse:
        appointment = self._locked_appointment(appointment_id)
        if appointment.status not in {"BOOKED", "CHECKED_IN", "COMPLETED"}:
            raise AppError("APPOINTMENT_INVALID_STATE", "This appointment fee cannot be adjusted.", 409)
        self._require_fee_adjustment_allowed()
        payment: Payment | None = None
        if appointment.status in {"CHECKED_IN", "COMPLETED"}:
            _visit, payment = self._locked_visit_payment(appointment.appointment_id)
            if payment.status != "PENDING":
                raise AppError(
                    "PAYMENT_INVALID_STATE",
                    "The fee cannot be changed after payment has been confirmed or closed.",
                    409,
                )
        previous = _money(appointment.effective_fee_amount)
        new = _money(request.amount)
        if previous == new:
            raise AppError("FEE_UNCHANGED", "The new fee is the same as the current fee.", 422)
        appointment.effective_fee_amount = new
        appointment.fee_adjustment_reason = request.reason.strip()
        appointment.fee_adjusted_by = self.context.user_id
        appointment.fee_adjusted_at = self.clock.now_utc()
        appointment.version += 1
        if payment is not None:
            payment.amount_due = new
        self._record_fee_adjustment(appointment, previous=previous, new=new, reason=request.reason)
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="FEE_ADJUSTED",
            entity_type="APPOINTMENT",
            entity_id=appointment.appointment_id,
            request_id=_request_id(),
            reason=request.reason,
            previous_values={"effective_fee_amount": str(previous)},
            new_values={"effective_fee_amount": str(new)},
        )
        return self._response(appointment)

    def _patient(self, patient_id: UUID) -> Patient:
        patient = self.db.scalar(
            select(Patient).where(
                Patient.patient_id == patient_id, Patient.clinic_id == self.context.clinic_id
            )
        )
        if patient is None:
            raise AppError("PATIENT_NOT_FOUND", "Patient not found.", 404)
        return patient

    def _lock_patient(self, patient_id: UUID) -> Patient:
        patient = self.db.scalar(
            select(Patient)
            .where(
                Patient.patient_id == patient_id,
                Patient.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if patient is None:
            raise AppError("PATIENT_NOT_FOUND", "Patient not found.", 404)
        return patient

    def _validate_no_duplicate_appointment(
        self,
        *,
        patient_id: UUID,
        doctor_id: UUID,
        appointment_date: date,
        exclude_appointment_id: UUID | None = None,
    ) -> None:
        query = (
            select(Appointment, SessionOccurrence)
            .join(
                SessionOccurrence,
                SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id,
            )
            .where(
                Appointment.clinic_id == self.context.clinic_id,
                Appointment.patient_id == patient_id,
                Appointment.doctor_id == doctor_id,
                SessionOccurrence.occurrence_date == appointment_date,
                Appointment.status != "CANCELLED",
            )
        )
        if exclude_appointment_id is not None:
            query = query.where(Appointment.appointment_id != exclude_appointment_id)

        existing = self.db.execute(query).first()
        if existing is not None:
            appt, occ = existing
            raise AppError(
                code="APPOINTMENT_DUPLICATE_ACTIVE",
                message="An active appointment already exists for this patient, doctor, and date.",
                status_code=409,
                details={
                    "appointment_id": str(appt.appointment_id),
                    "date": occ.occurrence_date.isoformat(),
                    "time": appt.appointment_time.isoformat() if appt.appointment_time else None,
                    "status": appt.status,
                    "appointment_type": appt.appointment_type,
                },
            )

    def _doctor(self, doctor_id: UUID) -> Doctor:
        doctor = self.db.scalar(
            select(Doctor).where(
                Doctor.doctor_id == doctor_id,
                Doctor.clinic_id == self.context.clinic_id,
                Doctor.active.is_(True),
            )
        )
        if doctor is None:
            raise AppError("DOCTOR_NOT_FOUND", "Doctor not found.", 404)
        return doctor

    def _appointment(self, appointment_id: UUID) -> Appointment:
        appointment = self.db.scalar(
            select(Appointment).where(
                Appointment.appointment_id == appointment_id,
                Appointment.clinic_id == self.context.clinic_id,
            )
        )
        if appointment is None:
            raise AppError("APPOINTMENT_NOT_FOUND", "Appointment not found.", 404)
        return appointment

    def _locked_appointment(self, appointment_id: UUID) -> Appointment:
        appointment = self.db.scalar(
            select(Appointment)
            .where(
                Appointment.appointment_id == appointment_id,
                Appointment.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if appointment is None:
            raise AppError("APPOINTMENT_NOT_FOUND", "Appointment not found.", 404)
        return appointment

    def _locked_visit_payment(self, appointment_id: UUID) -> tuple[Visit, Payment]:
        visit = self.db.scalar(
            select(Visit)
            .where(
                Visit.appointment_id == appointment_id,
                Visit.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if visit is None:
            raise AppError("VISIT_NOT_FOUND", "No visit exists for this appointment.", 409)
        payment = self.db.scalar(
            select(Payment)
            .where(
                Payment.visit_id == visit.visit_id,
                Payment.clinic_id == self.context.clinic_id,
                Payment.status.in_(["PENDING", "CONFIRMED"]),
            )
            .with_for_update()
        )
        if payment is None:
            raise AppError("PAYMENT_NOT_FOUND", "No current payment exists for this visit.", 409)
        return visit, payment

    def _lock_occurrence(self, occurrence_id: UUID) -> SessionOccurrence:
        occurrence = self.db.scalar(
            select(SessionOccurrence)
            .where(
                SessionOccurrence.session_occurrence_id == occurrence_id,
                SessionOccurrence.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if occurrence is None:  # pragma: no cover - materialization invariant
            raise RuntimeError("Session occurrence disappeared during booking")
        return occurrence

    @staticmethod
    def _validate_occurrence_doctor(occurrence: SessionOccurrence, doctor_id: UUID) -> None:
        if occurrence.doctor_id != doctor_id:
            raise AppError(
                "SESSION_DOCTOR_MISMATCH",
                "The selected session does not belong to this doctor.",
                422,
            )

    @staticmethod
    def _validate_booking_time(occurrence: SessionOccurrence, appointment_time: time) -> None:
        if appointment_time not in generate_slots(
            occurrence.start_time_snapshot,
            occurrence.end_time_snapshot,
            occurrence.slot_interval_minutes_snapshot,
        ):
            raise AppError(
                "INVALID_APPOINTMENT_TIME",
                "Choose one of the configured appointment times.",
                422,
            )

    def _availability_state(
        self,
        occurrence: SessionOccurrence,
        appointment_time: time,
        *,
        exclude_appointment_id: UUID | None = None,
    ) -> tuple[int, bool]:
        capacity_query = select(func.count(Appointment.appointment_id)).where(
            Appointment.clinic_id == self.context.clinic_id,
            Appointment.session_occurrence_id == occurrence.session_occurrence_id,
            Appointment.status != "CANCELLED",
        )
        slot_query = select(func.count(Appointment.appointment_id)).where(
            Appointment.clinic_id == self.context.clinic_id,
            Appointment.session_occurrence_id == occurrence.session_occurrence_id,
            Appointment.appointment_time == appointment_time,
            Appointment.status != "CANCELLED",
        )
        if exclude_appointment_id is not None:
            capacity_query = capacity_query.where(Appointment.appointment_id != exclude_appointment_id)
            slot_query = slot_query.where(Appointment.appointment_id != exclude_appointment_id)
        used_capacity = int(self.db.scalar(capacity_query) or 0)
        slot_taken = bool(self.db.scalar(slot_query))
        return used_capacity, slot_taken

    def _authorize_override(
        self,
        requested: CapacityOverrideInput | None,
        *,
        needs_override: bool,
        occurrence: SessionOccurrence,
        used_capacity: int,
        appointment_time: time | None,
    ) -> bool:
        if not needs_override:
            return False
        if requested is None or not requested.enabled:
            return False
        if "appointment.capacity_override" not in self.context.permissions:
            raise AppError(
                "PERMISSION_DENIED",
                "You don't have permission to add an extra appointment.",
                403,
            )
        if not requested.reason.strip():
            raise AppError("CAPACITY_OVERRIDE_REASON_REQUIRED", "Enter an override reason.", 422)
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="CAPACITY_OVERRIDE",
            entity_type="SESSION_OCCURRENCE",
            entity_id=occurrence.session_occurrence_id,
            request_id=_request_id(),
            reason=requested.reason,
            metadata={
                "capacity": occurrence.maximum_capacity_snapshot,
                "existing_count": used_capacity,
                "appointment_time": appointment_time.isoformat() if appointment_time else None,
                "session_status": occurrence.status,
            },
        )
        return True

    def _fee_for_type(self, appointment_type: str) -> Decimal:
        today = self.clock.clinic_date()
        fee = self.db.scalar(
            select(FeeConfiguration).where(
                FeeConfiguration.clinic_id == self.context.clinic_id,
                FeeConfiguration.effective_from <= today,
                (FeeConfiguration.effective_to.is_(None) | (FeeConfiguration.effective_to >= today)),
            )
        )
        if fee is None:
            raise AppError("FEE_CONFIGURATION_NOT_FOUND", "Clinic fees are not configured yet.", 409)
        return _money(fee.regular_fee if appointment_type == "REGULAR" else fee.followup_fee)

    def _require_fee_adjustment_allowed(self) -> None:
        if "OWNER_ADMIN" in self.context.roles:
            return
        today = self.clock.clinic_date()
        fee = self.db.scalar(
            select(FeeConfiguration).where(
                FeeConfiguration.clinic_id == self.context.clinic_id,
                FeeConfiguration.effective_from <= today,
                (FeeConfiguration.effective_to.is_(None) | (FeeConfiguration.effective_to >= today)),
            )
        )
        if fee is None or not fee.assistant_adjustment_allowed:
            raise AppError(
                "FEE_ADJUSTMENT_NOT_ALLOWED",
                "Fee adjustment is disabled for Assistant accounts.",
                403,
            )

    def _record_fee_adjustment(
        self,
        appointment: Appointment,
        *,
        previous: Decimal,
        new: Decimal,
        reason: str,
    ) -> None:
        self.db.add(
            AppointmentFeeAdjustment(
                clinic_id=self.context.clinic_id,
                appointment_id=appointment.appointment_id,
                previous_amount=previous,
                new_amount=new,
                reason=reason.strip(),
                adjusted_by=self.context.user_id,
                adjusted_at=self.clock.now_utc(),
            )
        )

    def _audit_created(
        self, appointment: Appointment, occurrence: SessionOccurrence, used_capacity: int
    ) -> None:
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="APPOINTMENT_CREATED",
            entity_type="APPOINTMENT",
            entity_id=appointment.appointment_id,
            request_id=_request_id(),
            new_values={
                "patient_id": str(appointment.patient_id),
                "doctor_id": str(appointment.doctor_id),
                "date": occurrence.occurrence_date.isoformat(),
                "time": appointment.appointment_time.isoformat() if appointment.appointment_time else None,
                "appointment_type": appointment.appointment_type,
                "status": appointment.status,
                "base_fee": str(appointment.base_fee_snapshot),
                "effective_fee": str(appointment.effective_fee_amount),
            },
            metadata={
                "capacity_before": used_capacity,
                "capacity": occurrence.maximum_capacity_snapshot,
                "capacity_override_used": appointment.capacity_override_used,
            },
        )

    def _booking_source(self) -> str:
        return "ADMIN" if "OWNER_ADMIN" in self.context.roles else "ASSISTANT"

    def _response(self, appointment: Appointment) -> AppointmentResponse:
        patient = self.db.get(Patient, appointment.patient_id)
        doctor = self.db.get(Doctor, appointment.doctor_id)
        occurrence = self.db.get(SessionOccurrence, appointment.session_occurrence_id)
        if patient is None or doctor is None or occurrence is None:  # pragma: no cover - FK invariant
            raise RuntimeError("Appointment reference integrity failure")
        visit = self.db.scalar(
            select(Visit).where(
                Visit.appointment_id == appointment.appointment_id,
                Visit.clinic_id == self.context.clinic_id,
            )
        )
        payment = None
        if visit is not None:
            payment = self.db.scalar(
                select(Payment)
                .where(
                    Payment.visit_id == visit.visit_id,
                    Payment.clinic_id == self.context.clinic_id,
                )
                .order_by(Payment.created_at.desc())
            )
        linked_followup = self.db.scalar(
            select(FollowUpRecommendation).where(
                FollowUpRecommendation.clinic_id == self.context.clinic_id,
                FollowUpRecommendation.linked_appointment_id == appointment.appointment_id,
            )
        )
        return AppointmentResponse(
            appointment_id=appointment.appointment_id,
            patient=AppointmentPatientSummary(
                patient_id=patient.patient_id,
                patient_code=patient.patient_code,
                full_name=patient.full_name,
                mobile_number=patient.mobile_e164,
            ),
            doctor=AppointmentDoctorSummary(
                doctor_id=doctor.doctor_id, display_name=doctor.display_name
            ),
            session=AppointmentSessionSummary(
                session_occurrence_id=occurrence.session_occurrence_id,
                session_definition_id=occurrence.session_definition_id,
                date=occurrence.occurrence_date,
                name=occurrence.session_name_snapshot,
                start_time=occurrence.start_time_snapshot,
                end_time=occurrence.end_time_snapshot,
            ),
            appointment_time=appointment.appointment_time,
            appointment_type=appointment.appointment_type,
            booking_source=appointment.booking_source,
            status=appointment.status,
            base_fee=_money(appointment.base_fee_snapshot),
            effective_fee=_money(appointment.effective_fee_amount),
            fee_adjusted=_money(appointment.base_fee_snapshot) != _money(appointment.effective_fee_amount),
            capacity_override_used=appointment.capacity_override_used,
            cancellation_reason=appointment.cancellation_reason,
            cancellation_note=appointment.cancellation_note,
            rescheduled_from_appointment_id=appointment.rescheduled_from_appointment_id,
            rescheduled_to_appointment_id=appointment.rescheduled_to_appointment_id,
            reminder_eligible=self._reminder_eligible(appointment, occurrence),
            visit_id=visit.visit_id if visit else None,
            visit_status=visit.status if visit else None,
            payment_id=payment.payment_id if payment else None,
            payment_status=payment.status if payment else None,
            linked_followup_id=linked_followup.followup_id if linked_followup else None,
            linked_followup_status=linked_followup.status if linked_followup else None,
            version=appointment.version,
            created_at=appointment.created_at,
        )

    def _reopen_linked_followup(self, appointment: Appointment) -> None:
        followup = self.db.scalar(
            select(FollowUpRecommendation)
            .where(
                FollowUpRecommendation.clinic_id == self.context.clinic_id,
                FollowUpRecommendation.linked_appointment_id == appointment.appointment_id,
                FollowUpRecommendation.status == "BOOKED",
            )
            .with_for_update()
        )
        if followup is None:
            return
        followup.status = "OPEN"
        followup.linked_appointment_id = None
        followup.version += 1
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="FOLLOWUP_REOPENED",
            entity_type="FOLLOWUP",
            entity_id=followup.followup_id,
            request_id=_request_id(),
            previous_values={
                "status": "BOOKED",
                "linked_appointment_id": str(appointment.appointment_id),
            },
            new_values={"status": "OPEN", "linked_appointment_id": None},
        )

    def _transfer_linked_followup(
        self, original: Appointment, replacement: Appointment
    ) -> None:
        followup = self.db.scalar(
            select(FollowUpRecommendation)
            .where(
                FollowUpRecommendation.clinic_id == self.context.clinic_id,
                FollowUpRecommendation.linked_appointment_id == original.appointment_id,
                FollowUpRecommendation.status == "BOOKED",
            )
            .with_for_update()
        )
        if followup is None:
            return
        followup.linked_appointment_id = replacement.appointment_id
        followup.version += 1
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="FOLLOWUP_RELINKED",
            entity_type="FOLLOWUP",
            entity_id=followup.followup_id,
            request_id=_request_id(),
            previous_values={"linked_appointment_id": str(original.appointment_id)},
            new_values={"linked_appointment_id": str(replacement.appointment_id)},
        )

    def _reminder_eligible(self, appointment: Appointment, occurrence: SessionOccurrence) -> bool:
        if appointment.status != "BOOKED" or appointment.appointment_time is None:
            return False
        clinic_now = self.clock.clinic_now()
        scheduled = datetime.combine(
            occurrence.occurrence_date,
            appointment.appointment_time,
            tzinfo=clinic_now.tzinfo,
        )
        return scheduled - clinic_now > timedelta(hours=24)

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
        self,
        record: IdempotencyRecord,
        response: AppointmentResponse | AppointmentRescheduleResponse,
        status: int,
        resource_type: str,
        resource_id: UUID,
    ) -> None:
        record.response_status = status
        record.response_body = response.model_dump(mode="json")
        record.resource_type = resource_type
        record.resource_id = resource_id
        self.db.flush()

    def _replay_appointment(self, record: IdempotencyRecord) -> AppointmentResponse | None:
        if record.response_body is None:
            return None
        return AppointmentResponse.model_validate(record.response_body)

    def _replay_reschedule(self, record: IdempotencyRecord) -> AppointmentRescheduleResponse | None:
        if record.response_body is None:
            return None
        return AppointmentRescheduleResponse.model_validate(record.response_body)
