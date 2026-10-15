"""Lifecycle row order: Appointment -> Visit -> Payment, held until commit.

Resolve immutable parent IDs without locking children first. Callers must acquire
these parents before any payment lock (including correction inserts with visit FKs).
Scheduling advisory-lock ordering is separate and unchanged.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.visits.models import Visit


def lock_visit_lifecycle(db: Session, clinic_id: UUID, visit_id: UUID) -> tuple[Appointment, Visit]:
    appointment_id = db.scalar(select(Visit.appointment_id).where(
        Visit.visit_id == visit_id, Visit.clinic_id == clinic_id
    ))
    if appointment_id is None:
        raise AppError("VISIT_NOT_FOUND", "Visit not found.", 404)
    appointment = db.scalar(
        select(Appointment).where(
            Appointment.appointment_id == appointment_id, Appointment.clinic_id == clinic_id
        ).with_for_update().execution_options(populate_existing=True)
    )
    if appointment is None:
        raise RuntimeError("Visit appointment integrity failure")
    visit = db.scalar(
        select(Visit).where(Visit.visit_id == visit_id, Visit.clinic_id == clinic_id)
        .with_for_update().execution_options(populate_existing=True)
    )
    if visit is None or visit.appointment_id != appointment_id:
        raise RuntimeError("Visit appointment integrity failure")
    return appointment, visit
