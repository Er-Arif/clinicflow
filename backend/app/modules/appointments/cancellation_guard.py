from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.payments.models import Payment
from app.modules.scheduling.models import SessionOccurrence
from app.modules.visits.models import Visit


def require_valid_cancellation_reason(
    db: Session,
    clinic_id: UUID,
    appointment_id: UUID,
    reason: str,
    clock: Clock,
) -> None:
    """Reject cancellation reasons that are impossible for the appointment state/time."""
    if reason.upper() != "NO_SHOW":
        return

    appointment = db.scalar(
        select(Appointment).where(
            Appointment.appointment_id == appointment_id,
            Appointment.clinic_id == clinic_id,
        )
    )
    if appointment is None:
        raise AppError("APPOINTMENT_NOT_FOUND", "Appointment not found.", 404)
    if appointment.status != "BOOKED":
        raise AppError(
            "INVALID_CANCELLATION_REASON",
            "Only a booked appointment can be marked as a no-show.",
            422,
        )
    if appointment.appointment_time is None:
        raise AppError(
            "INVALID_CANCELLATION_REASON",
            "An untimed appointment cannot be marked as a no-show.",
            422,
        )

    occurrence = db.get(SessionOccurrence, appointment.session_occurrence_id)
    if occurrence is None:  # pragma: no cover - protected by foreign key
        raise RuntimeError("Appointment occurrence missing")

    clinic_date = clock.clinic_date()
    clinic_time = clock.clinic_now().time().replace(tzinfo=None)
    scheduled_in_future = occurrence.occurrence_date > clinic_date or (
        occurrence.occurrence_date == clinic_date and appointment.appointment_time > clinic_time
    )
    if scheduled_in_future:
        raise AppError(
            "NO_SHOW_TOO_EARLY",
            "Mark as no-show only after the scheduled appointment time.",
            422,
        )


def require_payment_correction_before_cancellation(
    db: Session,
    clinic_id: UUID,
    appointment_id: UUID,
) -> None:
    """Block checked-in cancellation while money is still confirmed.

    Locks lifecycle rows in the canonical Appointment -> Visit -> Payment order so a
    concurrent payment confirmation cannot race past the cancellation check.
    """
    appointment = db.scalar(
        select(Appointment)
        .where(
            Appointment.appointment_id == appointment_id,
            Appointment.clinic_id == clinic_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if appointment is None:
        raise AppError("APPOINTMENT_NOT_FOUND", "Appointment not found.", 404)
    if appointment.status != "CHECKED_IN":
        return

    visit = db.scalar(
        select(Visit)
        .where(
            Visit.appointment_id == appointment_id,
            Visit.clinic_id == clinic_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if visit is None:
        return

    payment = db.scalar(
        select(Payment)
        .where(
            Payment.visit_id == visit.visit_id,
            Payment.clinic_id == clinic_id,
        )
        .order_by(Payment.created_at.desc())
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if payment is not None and payment.status == "CONFIRMED":
        raise AppError(
            "PAYMENT_CORRECTION_REQUIRED",
            "Void or correct the confirmed payment before cancelling this checked-in patient.",
            409,
        )
