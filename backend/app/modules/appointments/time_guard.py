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
    # Do not expose elapsed slots at all. This keeps ordinary booking, follow-up,
    # reschedule and capacity-override UIs on the same safe contract: a time that
    # has already passed cannot be selected or overridden.
    for session in response.sessions:
        session.slots = [
            slot
            for slot in session.slots
            if not is_past_or_current_slot(clock, response.date, slot.time)
        ]
    return response
