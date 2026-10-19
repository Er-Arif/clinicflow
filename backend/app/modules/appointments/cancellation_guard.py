from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.payments.models import Payment
from app.modules.visits.models import Visit


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
