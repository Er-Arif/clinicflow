from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.context import request_id_var
from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.appointments.service import AppointmentService, _money
from app.modules.audit.service import AuditService
from app.modules.followups.models import FollowUpRecommendation
from app.modules.followups.schemas import VisitCompleteRequest, VisitCompletionResponse
from app.modules.followups.service import FollowUpService
from app.modules.idempotency.models import IdempotencyRecord
from app.modules.idempotency.service import IdempotencyService
from app.modules.identity.service import AuthContext
from app.modules.messaging.service import ReminderService
from app.modules.payments.models import Payment
from app.modules.payments.schemas import PaymentSummary
from app.modules.scheduling.concurrency import acquire_doctor_date_locks
from app.modules.scheduling.models import SessionOccurrence
from app.modules.scheduling.service import SchedulingService
from app.modules.visits.models import Visit
from app.modules.visits.schemas import CheckInResponse, VisitResponse, WalkInRequest


def _request_id() -> UUID:
    value = request_id_var.get()
    if value is None:  # pragma: no cover - middleware invariant
        raise RuntimeError("request id missing")
    return UUID(value)


def require_checkin_date(occurrence_date: date, clinic_date: date) -> None:
    if occurrence_date != clinic_date:
        raise AppError(
            "CHECK_IN_DATE_MISMATCH",
            "This appointment can only be checked in on its scheduled clinic date.",
            409,
        )


class VisitService:
    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def get(self, visit_id: UUID) -> VisitResponse:
        visit = self.db.scalar(
            select(Visit).where(
                Visit.visit_id == visit_id,
                Visit.clinic_id == self.context.clinic_id,
            )
        )
        if visit is None:
            raise AppError("VISIT_NOT_FOUND", "Visit not found.", 404)
        return self._visit_response(visit)

    def check_in(self, appointment_id: UUID, *, idempotency_key: str) -> CheckInResponse:
        payload_hash = IdempotencyService.request_hash({"appointment_id": str(appointment_id)})
        record = self._reserve_idempotency("APPOINTMENT_CHECK_IN", idempotency_key, payload_hash)
        replay = self._replay_check_in(record)
        if replay is not None:
            return replay

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
        if appointment.status != "BOOKED":
            if appointment.status == "CHECKED_IN":
                raise AppError("VISIT_ALREADY_EXISTS", "This patient is already checked in.", 409)
            raise AppError(
                "APPOINTMENT_INVALID_STATE",
                "Only a booked appointment can be checked in.",
                409,
            )

        occurrence = self.db.get(SessionOccurrence, appointment.session_occurrence_id)
        if occurrence is None or occurrence.clinic_id != self.context.clinic_id:
            raise RuntimeError("Appointment session occurrence integrity failure")
        require_checkin_date(occurrence.occurrence_date, self.clock.clinic_date())
        if occurrence.status == "BLOCKED":
            raise AppError("SESSION_BLOCKED", "This session is currently blocked.", 409)

        if self.db.scalar(select(Visit.visit_id).where(Visit.appointment_id == appointment.appointment_id)):
            raise AppError("VISIT_ALREADY_EXISTS", "A visit already exists for this appointment.", 409)

        now = self.clock.now_utc()
        appointment.status = "CHECKED_IN"
        appointment.version += 1
        visit = Visit(
            clinic_id=self.context.clinic_id,
            appointment_id=appointment.appointment_id,
            patient_id=appointment.patient_id,
            doctor_id=appointment.doctor_id,
            visit_type=appointment.appointment_type,
            status="ACTIVE",
            checked_in_at=now,
            created_by=self.context.user_id,
        )
        self.db.add(visit)
        self.db.flush()
        payment = self._create_pending_payment(visit, appointment.effective_fee_amount)
        self.db.flush()

        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="PATIENT_CHECKED_IN",
            entity_type="VISIT",
            entity_id=visit.visit_id,
            request_id=_request_id(),
            new_values={
                "appointment_id": str(appointment.appointment_id),
                "patient_id": str(appointment.patient_id),
                "status": "ACTIVE",
                "payment_id": str(payment.payment_id),
                "payment_status": "PENDING",
            },
        )

        response = self._check_in_response(appointment, visit, payment)
        self._complete_idempotency(record, response, visit.visit_id, status=200)
        return response

    def walk_in(self, request: WalkInRequest, *, idempotency_key: str) -> CheckInResponse:
        payload_hash = IdempotencyService.request_hash(request.model_dump(mode="json"))
        record = self._reserve_idempotency("WALK_IN_CHECK_IN", idempotency_key, payload_hash)
        replay = self._replay_check_in(record)
        if replay is not None:
            return replay

        appointment_service = AppointmentService(self.db, self.clock, self.context)
        doctor = appointment_service._doctor(request.doctor_id)
        today = self.clock.clinic_date()
        acquire_doctor_date_locks(self.db, doctor.doctor_id, [today])
        patient = appointment_service._lock_patient(request.patient_id)
        appointment_service._validate_no_duplicate_appointment(
            patient_id=patient.patient_id,
            doctor_id=doctor.doctor_id,
            appointment_date=today,
        )
        occurrence = SchedulingService(self.db, self.clock, self.context).materialize_occurrence(
            request.session_definition_id, today, doctor_id=doctor.doctor_id
        )
        occurrence = appointment_service._lock_occurrence(occurrence.session_occurrence_id)
        appointment_service._validate_occurrence_doctor(occurrence, doctor.doctor_id)
        if occurrence.status == "BLOCKED":
            raise AppError("SESSION_BLOCKED", "This session is unavailable for walk-ins.", 409)

        used_capacity = int(
            self.db.scalar(
                select(func.count(Appointment.appointment_id)).where(
                    Appointment.clinic_id == self.context.clinic_id,
                    Appointment.session_occurrence_id == occurrence.session_occurrence_id,
                    Appointment.status != "CANCELLED",
                )
            )
            or 0
        )
        needs_override = used_capacity >= occurrence.maximum_capacity_snapshot
        override = appointment_service._authorize_override(
            request.capacity_override,
            needs_override=needs_override,
            occurrence=occurrence,
            used_capacity=used_capacity,
            appointment_time=None,
        )
        if needs_override and not override:
            raise AppError("SESSION_FULL", "This session is already full.", 409)

        base_fee = appointment_service._fee_for_type(request.appointment_type)
        effective_fee = base_fee
        if request.fee_adjustment is not None:
            appointment_service._require_fee_adjustment_allowed()
            effective_fee = _money(request.fee_adjustment.amount)

        now = self.clock.now_utc()
        appointment = Appointment(
            clinic_id=self.context.clinic_id,
            patient_id=patient.patient_id,
            doctor_id=doctor.doctor_id,
            session_occurrence_id=occurrence.session_occurrence_id,
            appointment_time=None,
            appointment_type=request.appointment_type,
            booking_source="WALK_IN",
            status="CHECKED_IN",
            base_fee_snapshot=base_fee,
            effective_fee_amount=effective_fee,
            fee_adjustment_reason=(
                request.fee_adjustment.reason.strip() if request.fee_adjustment else None
            ),
            fee_adjusted_by=(self.context.user_id if request.fee_adjustment else None),
            fee_adjusted_at=(now if request.fee_adjustment else None),
            created_by=self.context.user_id,
            capacity_override_used=override,
            capacity_override_by=(self.context.user_id if override else None),
            capacity_override_at=(now if override else None),
            capacity_override_reason=(
                request.capacity_override.reason.strip()
                if override and request.capacity_override
                else None
            ),
            override_capacity_snapshot=(occurrence.maximum_capacity_snapshot if override else None),
            override_existing_count=(used_capacity if override else None),
        )
        self.db.add(appointment)
        self.db.flush()
        if request.fee_adjustment is not None and effective_fee != base_fee:
            appointment_service._record_fee_adjustment(
                appointment,
                previous=base_fee,
                new=effective_fee,
                reason=request.fee_adjustment.reason,
            )
        appointment_service._audit_created(appointment, occurrence, used_capacity)

        visit = Visit(
            clinic_id=self.context.clinic_id,
            appointment_id=appointment.appointment_id,
            patient_id=appointment.patient_id,
            doctor_id=appointment.doctor_id,
            visit_type=appointment.appointment_type,
            status="ACTIVE",
            checked_in_at=now,
            created_by=self.context.user_id,
        )
        self.db.add(visit)
        self.db.flush()
        payment = self._create_pending_payment(visit, appointment.effective_fee_amount)
        self.db.flush()

        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="PATIENT_CHECKED_IN",
            entity_type="VISIT",
            entity_id=visit.visit_id,
            request_id=_request_id(),
            metadata={"walk_in": True},
            new_values={
                "appointment_id": str(appointment.appointment_id),
                "patient_id": str(appointment.patient_id),
                "status": "ACTIVE",
                "payment_id": str(payment.payment_id),
                "payment_status": "PENDING",
            },
        )

        response = self._check_in_response(appointment, visit, payment)
        self._complete_idempotency(record, response, visit.visit_id, status=201)
        return response

    def complete(
        self,
        visit_id: UUID,
        request: VisitCompleteRequest,
        *,
        idempotency_key: str,
    ) -> VisitCompletionResponse:
        payload_hash = IdempotencyService.request_hash(
            {"visit_id": str(visit_id), **request.model_dump(mode="json")}
        )
        record = self._reserve_idempotency("VISIT_COMPLETE", idempotency_key, payload_hash)
        if record.response_body is not None:
            return VisitCompletionResponse.model_validate(record.response_body)

        visit = self.db.scalar(
            select(Visit)
            .where(
                Visit.visit_id == visit_id,
                Visit.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if visit is None:
            raise AppError("VISIT_NOT_FOUND", "Visit not found.", 404)
        if visit.status != "ACTIVE":
            raise AppError("VISIT_INVALID_STATE", "Only an active visit can be completed.", 409)

        appointment = self.db.scalar(
            select(Appointment)
            .where(
                Appointment.appointment_id == visit.appointment_id,
                Appointment.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if appointment is None:
            raise RuntimeError("Visit appointment integrity failure")
        if appointment.status != "CHECKED_IN":
            raise AppError(
                "APPOINTMENT_INVALID_STATE",
                "The appointment must be checked in before completing the visit.",
                409,
            )

        payment = self.db.scalar(
            select(Payment)
            .where(
                Payment.visit_id == visit.visit_id,
                Payment.clinic_id == self.context.clinic_id,
                Payment.status.in_(["PENDING", "CONFIRMED"]),
            )
            .with_for_update()
        )
        now = self.clock.now_utc()
        today = self.clock.clinic_date()

        previous_followup = self.db.scalar(
            select(FollowUpRecommendation)
            .where(
                FollowUpRecommendation.clinic_id == self.context.clinic_id,
                FollowUpRecommendation.linked_appointment_id == appointment.appointment_id,
                FollowUpRecommendation.status == "BOOKED",
            )
            .with_for_update()
        )
        closed_previous_id: UUID | None = None
        if previous_followup is not None:
            previous_followup.status = "CLOSED"
            previous_followup.closed_by = self.context.user_id
            previous_followup.closed_at = now
            previous_followup.close_reason = "FOLLOWUP_VISIT_COMPLETED"
            previous_followup.version += 1
            closed_previous_id = previous_followup.followup_id
            AuditService(self.db).record(
                clinic_id=self.context.clinic_id,
                actor_type="USER",
                actor_user_id=self.context.user_id,
                action_type="FOLLOWUP_CLOSED",
                entity_type="FOLLOWUP",
                entity_id=previous_followup.followup_id,
                request_id=_request_id(),
                previous_values={"status": "BOOKED"},
                new_values={"status": "CLOSED", "reason": "FOLLOWUP_VISIT_COMPLETED"},
            )

        new_followup: FollowUpRecommendation | None = None
        if request.follow_up is not None:
            if request.follow_up.interval_days is not None:
                due_date = today + timedelta(days=request.follow_up.interval_days)
                interval_days = request.follow_up.interval_days
            else:
                due_date = request.follow_up.due_date
                interval_days = None
                if due_date is None:  # pragma: no cover - pydantic invariant
                    raise RuntimeError("Follow-up due date missing")
                if due_date < today:
                    raise AppError(
                        "FOLLOWUP_DUE_DATE_PAST",
                        "Follow-up due date cannot be in the past.",
                        422,
                    )
            new_followup = FollowUpRecommendation(
                clinic_id=self.context.clinic_id,
                patient_id=visit.patient_id,
                source_visit_id=visit.visit_id,
                due_date=due_date,
                interval_days=interval_days,
                status="OPEN",
                created_by=self.context.user_id,
            )
            self.db.add(new_followup)
            self.db.flush()
            ReminderService(self.db, self.clock, self.context).ensure_followup_reminder(new_followup)
            AuditService(self.db).record(
                clinic_id=self.context.clinic_id,
                actor_type="USER",
                actor_user_id=self.context.user_id,
                action_type="FOLLOWUP_CREATED",
                entity_type="FOLLOWUP",
                entity_id=new_followup.followup_id,
                request_id=_request_id(),
                new_values={
                    "status": "OPEN",
                    "source_visit_id": str(visit.visit_id),
                    "due_date": due_date.isoformat(),
                    "interval_days": interval_days,
                },
            )

        visit.status = "COMPLETED"
        visit.completed_at = now
        appointment.status = "COMPLETED"
        appointment.version += 1
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="VISIT_COMPLETED",
            entity_type="VISIT",
            entity_id=visit.visit_id,
            request_id=_request_id(),
            previous_values={"status": "ACTIVE"},
            new_values={
                "status": "COMPLETED",
                "appointment_id": str(appointment.appointment_id),
                "payment_status": payment.status if payment else None,
                "followup_id": str(new_followup.followup_id) if new_followup else None,
            },
        )

        followup_response = (
            FollowUpService(self.db, self.clock, self.context)._response(new_followup)
            if new_followup is not None
            else None
        )
        response = VisitCompletionResponse(
            appointment=AppointmentService(self.db, self.clock, self.context)._response(appointment),
            visit_id=visit.visit_id,
            visit_status=visit.status,
            completed_at=visit.completed_at,
            payment_status=payment.status if payment else None,
            followup=followup_response,
            closed_previous_followup_id=closed_previous_id,
        )
        record.response_status = 200
        record.response_body = response.model_dump(mode="json")
        record.resource_type = "VISIT"
        record.resource_id = visit.visit_id
        self.db.flush()
        return response

    def _create_pending_payment(self, visit: Visit, amount_due: Decimal) -> Payment:
        payment = Payment(
            clinic_id=self.context.clinic_id,
            visit_id=visit.visit_id,
            patient_id=visit.patient_id,
            amount_due=_money(amount_due),
            status="PENDING",
        )
        self.db.add(payment)
        return payment

    def _check_in_response(
        self, appointment: Appointment, visit: Visit, payment: Payment
    ) -> CheckInResponse:
        return CheckInResponse(
            appointment=AppointmentService(self.db, self.clock, self.context)._response(appointment),
            visit=self._visit_response(visit, payment=payment),
            payment=self._payment_summary(payment),
        )

    def _visit_response(self, visit: Visit, *, payment: Payment | None = None) -> VisitResponse:
        if payment is None:
            payment = self.db.scalar(
                select(Payment)
                .where(
                    Payment.visit_id == visit.visit_id,
                    Payment.clinic_id == self.context.clinic_id,
                )
                .order_by(Payment.created_at.desc())
            )
        return VisitResponse(
            visit_id=visit.visit_id,
            appointment_id=visit.appointment_id,
            patient_id=visit.patient_id,
            doctor_id=visit.doctor_id,
            visit_type=visit.visit_type,
            status=visit.status,
            checked_in_at=visit.checked_in_at,
            completed_at=visit.completed_at,
            aborted_at=visit.aborted_at,
            payment=self._payment_summary(payment) if payment is not None else None,
        )

    @staticmethod
    def _payment_summary(payment: Payment) -> PaymentSummary:
        return PaymentSummary(
            payment_id=payment.payment_id,
            visit_id=payment.visit_id,
            amount_due=_money(payment.amount_due),
            amount_paid=_money(payment.amount_paid) if payment.amount_paid is not None else None,
            payment_method=payment.payment_method,
            status=payment.status,
            created_at=payment.created_at,
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
        self,
        record: IdempotencyRecord,
        response: CheckInResponse,
        resource_id: UUID,
        *,
        status: int,
    ) -> None:
        record.response_status = status
        record.response_body = response.model_dump(mode="json")
        record.resource_type = "VISIT"
        record.resource_id = resource_id
        self.db.flush()

    @staticmethod
    def _replay_check_in(record: IdempotencyRecord) -> CheckInResponse | None:
        if record.response_body is None:
            return None
        return CheckInResponse.model_validate(record.response_body)
