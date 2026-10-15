from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.modules.identity.service import AuthContext
from app.modules.scheduling.schemas import AvailabilityResponse
from app.modules.scheduling.service import SchedulingService


class AppointmentAvailabilityService:
    """Appointment API facade for the shared effective-occupancy read model."""

    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def get(self, doctor_id: UUID, target_date: date) -> AvailabilityResponse:
        return SchedulingService(self.db, self.clock, self.context).availability(
            doctor_id, target_date
        )
