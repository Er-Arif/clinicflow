from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.modules.appointments.models import Appointment
from app.modules.identity.service import AuthContext
from app.modules.scheduling.schemas import (
    AvailabilityResponse,
    AvailabilitySession,
    AvailabilitySlot,
)
from app.modules.scheduling.service import SchedulingService


class AppointmentAvailabilityService:
    """Occupancy-aware availability read model.

    Scheduling defines sessions. Appointments owns consumption of those sessions, so
    occupancy joins live here rather than introducing an upward Scheduling dependency.
    """

    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def get(self, doctor_id: UUID, target_date: date) -> AvailabilityResponse:
        baseline = SchedulingService(self.db, self.clock, self.context).availability(
            doctor_id, target_date
        )
        result: list[AvailabilitySession] = []
        for session in baseline.sessions:
            if session.session_occurrence_id is None:
                result.append(session)
                continue
            occurrence_id = session.session_occurrence_id
            rows = self.db.execute(
                select(Appointment.appointment_time, func.count(Appointment.appointment_id))
                .where(
                    Appointment.clinic_id == self.context.clinic_id,
                    Appointment.session_occurrence_id == occurrence_id,
                    Appointment.status != "CANCELLED",
                )
                .group_by(Appointment.appointment_time)
            ).all()
            counts = {appointment_time: int(count) for appointment_time, count in rows}
            used_capacity = sum(counts.values())
            remaining = max(session.maximum_capacity - used_capacity, 0)
            session_sendable = session.status == "AVAILABLE" and remaining > 0
            slots = [
                AvailabilitySlot(
                    time=slot.time,
                    available=counts.get(slot.time, 0) == 0 and session_sendable,
                    normal_booking_allowed=counts.get(slot.time, 0) == 0 and session_sendable,
                )
                for slot in session.slots
            ]
            result.append(
                session.model_copy(
                    update={
                        "used_capacity": used_capacity,
                        "remaining_capacity": remaining,
                        "slots": slots,
                    }
                )
            )
        return AvailabilityResponse(doctor_id=doctor_id, date=target_date, sessions=result)
