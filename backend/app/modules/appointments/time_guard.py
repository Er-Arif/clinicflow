from __future__ import annotations

from datetime import date, time

from app.core.clock import Clock
from app.core.errors import AppError
from app.modules.scheduling.schemas import AvailabilityResponse


def is_past_or_current_slot(clock: Clock, target_date: date, slot_time: time) -> bool:
    today = clock.clinic_date()
    if target_date < today:
        return True
    if target_date > today:
        return False
    current_time = clock.clinic_now().time().replace(tzinfo=None)
    return slot_time <= current_time


def require_future_slot(clock: Clock, target_date: date, slot_time: time) -> None:
    if target_date == clock.clinic_date() and is_past_or_current_slot(clock, target_date, slot_time):
        raise AppError(
            "APPOINTMENT_TIME_PAST",
            "Select an appointment time later than the current clinic time.",
            422,
        )


def apply_booking_time_rules(
    response: AvailabilityResponse,
    clock: Clock,
) -> AvailabilityResponse:
    for session in response.sessions:
        for slot in session.slots:
            past = is_past_or_current_slot(clock, response.date, slot.time)
            # Capacity/occupied-slot conflicts may be overridden by authorized
            # staff. Time itself never can: a past slot is not a valid booking
            # target even when capacity override is available.
            slot.override_booking_allowed = session.status == "AVAILABLE" and not past
            if past:
                slot.available = False
                slot.normal_booking_allowed = False
    return response
