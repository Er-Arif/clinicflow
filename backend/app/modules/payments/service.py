from __future__ import annotations

from datetime import date
from decimal import Decimal
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.context import request_id_var
from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.appointments.service import _money
from app.modules.audit.service import AuditService
from app.modules.clinic.models import Clinic, Doctor
from app.modules.idempotency.models import IdempotencyRecord
from app.modules.idempotency.service import IdempotencyService
from app.modules.identity.service import AuthContext
from app.modules.patients.models import NumberCounter, Patient
from app.modules.payments.models import Payment, Receipt, UpiConfiguration
from app.modules.payments.schemas import (
    PaymentConfirmationResponse,
    PaymentConfirmRequest,
    PaymentListResponse,
    PaymentResponse,
    PaymentVoidRequest,
    PaymentVoidResponse,
    ReceiptResponse,
    UpiConfigurationResponse,
    UpiConfigurationUpdateRequest,
    UpiIntentResponse,
)
from app.modules.scheduling.models import SessionOccurrence
from app.modules.visits.models import Visit


def format_receipt_number(year: int, sequence: int) -> str:
    return f"RCT-{year}-{sequence:06d}"


def build_upi_uri(*, upi_id: str, payee_name: str, amount: Decimal, reference: str) -> str:
    note = "Clinic Consultation"
    params = urlencode(
        {
            "pa": upi_id,
            "pn": payee_name,
            "am": f"{_money(amount):.2f}",
            "cu": "INR",
            "tr": reference,
            "tn": note,
        }
    )
    return f"upi://pay?{params}"

def _request_id() -> UUID:
    value = request_id_var.get()
    if value is None:  # pragma: no cover - middleware invariant
        raise RuntimeError("request id missing")
    return UUID(value)


class PaymentService:
    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def list(
        self,
        *,
        status: str | None = None,
        target_date: date | None = None,
        patient_id: UUID | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> PaymentListResponse:
        conditions = [Payment.clinic_id == self.context.clinic_id]
        if status:
            normalized = status.upper()
            if normalized not in {"PENDING", "CONFIRMED", "CANCELLED", "VOID"}:
                raise AppError("INVALID_PAYMENT_STATUS", "Invalid payment status filter.", 422)
            conditions.append(Payment.status == normalized)
        if patient_id:
            conditions.append(Payment.patient_id == patient_id)
        if target_date:
            conditions.append(SessionOccurrence.occurrence_date == target_date)

        stmt = (
            select(Payment, Patient, Visit, Appointment, SessionOccurrence, Receipt)
            .join(Visit, Visit.visit_id == Payment.visit_id)
            .join(Appointment, Appointment.appointment_id == Visit.appointment_id)
            .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
            .join(Patient, Patient.patient_id == Payment.patient_id)
            .outerjoin(Receipt, Receipt.payment_id == Payment.payment_id)
            .where(*conditions)
            .order_by(Payment.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = self.db.execute(stmt).all()
        total = int(
            self.db.scalar(
                select(func.count(Payment.payment_id))
                .join(Visit, Visit.visit_id == Payment.visit_id)
                .join(Appointment, Appointment.appointment_id == Visit.appointment_id)
                .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
                .where(*conditions)
            )
            or 0
        )
        return PaymentListResponse(
            items=[self._row_response(*row) for row in rows],
            total=total,
            limit=limit,
            offset=offset,
        )

    def get(self, payment_id: UUID) -> PaymentResponse:
        return self._response_for_id(payment_id)

    def confirm(
        self,
        payment_id: UUID,
        request: PaymentConfirmRequest,
        *,
        idempotency_key: str,
    ) -> PaymentConfirmationResponse:
        payload_hash = IdempotencyService.request_hash(
            {"payment_id": str(payment_id), **request.model_dump(mode="json")}
        )
        record = self._reserve_idempotency("PAYMENT_CONFIRM", idempotency_key, payload_hash)
        if record.response_body is not None:
            return PaymentConfirmationResponse.model_validate(record.response_body)

        payment = self._locked_payment(payment_id)
        if payment.status == "CONFIRMED":
            raise AppError("PAYMENT_ALREADY_CONFIRMED", "Payment has already been confirmed.", 409)
        if payment.status != "PENDING":
            raise AppError("PAYMENT_INVALID_STATE", "Only a pending payment can be confirmed.", 409)

        visit = self.db.scalar(
            select(Visit).where(
                Visit.visit_id == payment.visit_id,
                Visit.clinic_id == self.context.clinic_id,
            ).with_for_update()
        )
        if visit is None:
            raise RuntimeError("Payment visit integrity failure")
        if visit.status == "ABORTED":
            raise AppError("VISIT_ABORTED", "Payment cannot be confirmed for an aborted visit.", 409)
        if visit.status not in {"ACTIVE", "COMPLETED"}:
            raise AppError("VISIT_INVALID_STATE", "This visit cannot accept payment.", 409)

        now = self.clock.now_utc()
        payment.status = "CONFIRMED"
        payment.payment_method = request.payment_method
        payment.amount_paid = payment.amount_due
        payment.confirmation_source = "ASSISTANT"
        payment.confirmed_by = self.context.user_id
        payment.confirmed_at = now
        self.db.flush()

        receipt = self._create_receipt(payment, visit, now)
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="PAYMENT_CONFIRMED",
            entity_type="PAYMENT",
            entity_id=payment.payment_id,
            request_id=_request_id(),
            new_values={
                "status": "CONFIRMED",
                "payment_method": payment.payment_method,
                "amount_paid": str(_money(payment.amount_paid)),
                "receipt_number": receipt.receipt_number,
            },
        )

        response = PaymentConfirmationResponse(
            payment=self._response_for_id(payment.payment_id),
            receipt=self._receipt_response(receipt, payment),
        )
        self._complete_idempotency(record, response, payment.payment_id, status=200)
        return response

    def void(
        self,
        payment_id: UUID,
        request: PaymentVoidRequest,
        *,
        idempotency_key: str,
    ) -> PaymentVoidResponse:
        payload_hash = IdempotencyService.request_hash(
            {"payment_id": str(payment_id), **request.model_dump(mode="json")}
        )
        record = self._reserve_idempotency("PAYMENT_VOID", idempotency_key, payload_hash)
        if record.response_body is not None:
            return PaymentVoidResponse.model_validate(record.response_body)

        payment = self._locked_payment(payment_id)
        if payment.status != "CONFIRMED":
            raise AppError("PAYMENT_INVALID_STATE", "Only a confirmed payment can be voided.", 409)
        now = self.clock.now_utc()
        payment.status = "VOID"
        payment.voided_by = self.context.user_id
        payment.voided_at = now
        payment.void_reason = request.reason.strip()
        self.db.flush()

        replacement: Payment | None = None
        if request.create_replacement_payment:
            replacement = Payment(
                clinic_id=self.context.clinic_id,
                visit_id=payment.visit_id,
                patient_id=payment.patient_id,
                amount_due=payment.amount_due,
                status="PENDING",
                correction_of_payment_id=payment.payment_id,
            )
            self.db.add(replacement)
            self.db.flush()

        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="PAYMENT_VOIDED",
            entity_type="PAYMENT",
            entity_id=payment.payment_id,
            request_id=_request_id(),
            reason=request.reason.strip(),
            previous_values={"status": "CONFIRMED"},
            new_values={
                "status": "VOID",
                "replacement_payment_id": str(replacement.payment_id) if replacement else None,
            },
        )
        if replacement is not None:
            AuditService(self.db).record(
                clinic_id=self.context.clinic_id,
                actor_type="USER",
                actor_user_id=self.context.user_id,
                action_type="PAYMENT_CORRECTION_CREATED",
                entity_type="PAYMENT",
                entity_id=replacement.payment_id,
                request_id=_request_id(),
                new_values={
                    "status": "PENDING",
                    "correction_of_payment_id": str(payment.payment_id),
                    "amount_due": str(_money(replacement.amount_due)),
                },
            )

        response = PaymentVoidResponse(
            voided=self._response_for_id(payment.payment_id),
            replacement=(self._response_for_id(replacement.payment_id) if replacement else None),
        )
        self._complete_idempotency(record, response, payment.payment_id, status=200)
        return response

    def receipt(self, payment_id: UUID) -> ReceiptResponse:
        payment = self._payment(payment_id)
        receipt = self.db.scalar(
            select(Receipt).where(
                Receipt.payment_id == payment.payment_id,
                Receipt.clinic_id == self.context.clinic_id,
            )
        )
        if receipt is None:
            raise AppError("RECEIPT_NOT_FOUND", "No receipt exists for this payment.", 404)
        return self._receipt_response(receipt, payment)

    def upi_intent(self, payment_id: UUID) -> UpiIntentResponse:
        payment = self._payment(payment_id)
        if payment.status != "PENDING":
            raise AppError("PAYMENT_INVALID_STATE", "UPI can only be prepared for a pending payment.", 409)
        visit = self.db.get(Visit, payment.visit_id)
        if visit is None or visit.clinic_id != self.context.clinic_id:
            raise RuntimeError("Payment visit integrity failure")
        if visit.status == "ABORTED":
            raise AppError("VISIT_ABORTED", "UPI cannot be prepared for an aborted visit.", 409)
        config = self._upi_config(required_active=True)
        reference = f"CF-{payment.payment_id.hex[:20].upper()}"
        note = "Clinic Consultation"
        upi_uri = build_upi_uri(
            upi_id=config.upi_id,
            payee_name=config.payee_name,
            amount=payment.amount_due,
            reference=reference,
        )
        return UpiIntentResponse(
            payment_id=payment.payment_id,
            amount=_money(payment.amount_due),
            upi_id=config.upi_id,
            payee_name=config.payee_name,
            transaction_reference=reference,
            note=note,
            upi_uri=upi_uri,
        )

    def get_upi_configuration(self) -> UpiConfigurationResponse:
        config = self._upi_config(required_active=False)
        return self._upi_response(config)

    def update_upi_configuration(
        self, request: UpiConfigurationUpdateRequest
    ) -> UpiConfigurationResponse:
        config = self.db.scalar(
            select(UpiConfiguration)
            .where(UpiConfiguration.clinic_id == self.context.clinic_id)
            .with_for_update()
        )
        now = self.clock.now_utc()
        if config is None:
            if request.expected_version not in {None, 1}:
                raise AppError("STALE_VERSION", "UPI settings changed. Reload and try again.", 409)
            config = UpiConfiguration(
                clinic_id=self.context.clinic_id,
                upi_id=request.upi_id,
                payee_name=request.payee_name,
                active=request.active,
                version=1,
                updated_by=self.context.user_id,
                updated_at=now,
            )
            self.db.add(config)
            previous = None
            action = "UPI_CONFIG_CREATED"
        else:
            if request.expected_version is None or config.version != request.expected_version:
                raise AppError("STALE_VERSION", "UPI settings changed. Reload and try again.", 409)
            previous = {
                "upi_id": config.upi_id,
                "payee_name": config.payee_name,
                "active": config.active,
                "version": config.version,
            }
            config.upi_id = request.upi_id
            config.payee_name = request.payee_name
            config.active = request.active
            config.version += 1
            config.updated_by = self.context.user_id
            config.updated_at = now
            action = "UPI_CONFIG_CHANGED"
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type=action,
            entity_type="UPI_CONFIGURATION",
            entity_id=config.upi_configuration_id,
            request_id=_request_id(),
            previous_values=previous,
            new_values={
                "upi_id": config.upi_id,
                "payee_name": config.payee_name,
                "active": config.active,
                "version": config.version,
            },
        )
        return self._upi_response(config)

    def _create_receipt(self, payment: Payment, visit: Visit, issued_at) -> Receipt:
        appointment = self.db.get(Appointment, visit.appointment_id)
        if appointment is None or appointment.clinic_id != self.context.clinic_id:
            raise RuntimeError("Visit appointment integrity failure")
        occurrence = self.db.get(SessionOccurrence, appointment.session_occurrence_id)
        patient = self.db.get(Patient, payment.patient_id)
        doctor = self.db.get(Doctor, visit.doctor_id)
        clinic = self.db.get(Clinic, self.context.clinic_id)
        if any(value is None for value in (occurrence, patient, doctor, clinic)):
            raise RuntimeError("Receipt snapshot integrity failure")
        number = self._next_receipt_number()
        receipt = Receipt(
            clinic_id=self.context.clinic_id,
            payment_id=payment.payment_id,
            receipt_number=number,
            issued_at=issued_at,
            clinic_name_snapshot=clinic.clinic_name,
            doctor_name_snapshot=doctor.display_name,
            patient_name_snapshot=patient.full_name,
            appointment_type_snapshot=appointment.appointment_type,
            visit_date_snapshot=occurrence.occurrence_date,
            amount_snapshot=payment.amount_due,
            payment_method_snapshot=payment.payment_method,
        )
        self.db.add(receipt)
        return receipt

    def _next_receipt_number(self) -> str:
        year = self.clock.clinic_date().year
        key = f"RECEIPT:{year}"
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
        if counter is None:  # pragma: no cover - DB invariant
            raise RuntimeError("Receipt counter creation failed")
        counter.last_value += 1
        return format_receipt_number(year, counter.last_value)

    def _response_for_id(self, payment_id: UUID) -> PaymentResponse:
        row = self.db.execute(
            select(Payment, Patient, Visit, Appointment, SessionOccurrence, Receipt)
            .join(Visit, Visit.visit_id == Payment.visit_id)
            .join(Appointment, Appointment.appointment_id == Visit.appointment_id)
            .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
            .join(Patient, Patient.patient_id == Payment.patient_id)
            .outerjoin(Receipt, Receipt.payment_id == Payment.payment_id)
            .where(
                Payment.payment_id == payment_id,
                Payment.clinic_id == self.context.clinic_id,
            )
        ).first()
        if row is None:
            raise AppError("PAYMENT_NOT_FOUND", "Payment not found.", 404)
        return self._row_response(*row)

    @staticmethod
    def _row_response(
        payment: Payment,
        patient: Patient,
        visit: Visit,
        appointment: Appointment,
        occurrence: SessionOccurrence,
        receipt: Receipt | None,
    ) -> PaymentResponse:
        return PaymentResponse(
            payment_id=payment.payment_id,
            visit_id=payment.visit_id,
            patient_id=payment.patient_id,
            patient_code=patient.patient_code,
            patient_name=patient.full_name,
            visit_date=occurrence.occurrence_date,
            appointment_type=appointment.appointment_type,
            amount_due=_money(payment.amount_due),
            amount_paid=_money(payment.amount_paid) if payment.amount_paid is not None else None,
            payment_method=payment.payment_method,
            status=payment.status,
            confirmation_source=payment.confirmation_source,
            confirmed_by=payment.confirmed_by,
            confirmed_at=payment.confirmed_at,
            cancelled_at=payment.cancelled_at,
            cancel_reason=payment.cancel_reason,
            voided_at=payment.voided_at,
            void_reason=payment.void_reason,
            correction_of_payment_id=payment.correction_of_payment_id,
            receipt_number=receipt.receipt_number if receipt else None,
            created_at=payment.created_at,
        )

    def _receipt_response(self, receipt: Receipt, payment: Payment) -> ReceiptResponse:
        return ReceiptResponse(
            receipt_id=receipt.receipt_id,
            payment_id=receipt.payment_id,
            receipt_number=receipt.receipt_number,
            issued_at=receipt.issued_at,
            clinic_name=receipt.clinic_name_snapshot,
            doctor_name=receipt.doctor_name_snapshot,
            patient_name=receipt.patient_name_snapshot,
            appointment_type=receipt.appointment_type_snapshot,
            visit_date=receipt.visit_date_snapshot,
            amount=_money(receipt.amount_snapshot),
            payment_method=receipt.payment_method_snapshot,
            voided=payment.status == "VOID",
        )

    def _payment(self, payment_id: UUID) -> Payment:
        payment = self.db.scalar(
            select(Payment).where(
                Payment.payment_id == payment_id,
                Payment.clinic_id == self.context.clinic_id,
            )
        )
        if payment is None:
            raise AppError("PAYMENT_NOT_FOUND", "Payment not found.", 404)
        return payment

    def _locked_payment(self, payment_id: UUID) -> Payment:
        payment = self.db.scalar(
            select(Payment)
            .where(
                Payment.payment_id == payment_id,
                Payment.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if payment is None:
            raise AppError("PAYMENT_NOT_FOUND", "Payment not found.", 404)
        return payment

    def _upi_config(self, *, required_active: bool) -> UpiConfiguration:
        config = self.db.scalar(
            select(UpiConfiguration).where(UpiConfiguration.clinic_id == self.context.clinic_id)
        )
        if config is None:
            raise AppError("UPI_NOT_CONFIGURED", "UPI payment details have not been configured.", 409)
        if required_active and not config.active:
            raise AppError("UPI_DISABLED", "UPI payments are currently disabled.", 409)
        return config

    @staticmethod
    def _upi_response(config: UpiConfiguration) -> UpiConfigurationResponse:
        return UpiConfigurationResponse(
            upi_configuration_id=config.upi_configuration_id,
            upi_id=config.upi_id,
            payee_name=config.payee_name,
            active=config.active,
            version=config.version,
            updated_at=config.updated_at,
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
        response: PaymentConfirmationResponse | PaymentVoidResponse,
        resource_id: UUID,
        *,
        status: int,
    ) -> None:
        record.response_status = status
        record.response_body = response.model_dump(mode="json")
        record.resource_type = "PAYMENT"
        record.resource_id = resource_id
        self.db.flush()
