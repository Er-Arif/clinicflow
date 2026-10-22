from datetime import date, datetime, time
from uuid import UUID

import pytest

from app.core.errors import AppError
from app.modules.appointments.time_guard import (
    apply_booking_time_rules,
    is_past_or_current_slot,
    require_future_slot,
)
from app.modules.scheduling.schemas import AvailabilityResponse, AvailabilitySession, AvailabilitySlot


class FrozenClock:
    def clinic_date(self) -> date:
        return date(2026, 10, 22)

    def clinic_now(self) -> datetime:
        return datetime(2026, 10, 22, 21, 58, 0)


def test_same_day_elapsed_slots_are_not_bookable() -> None:
    clock = FrozenClock()
    assert is_past_or_current_slot(clock, date(2026, 10, 22), time(21, 45)) is True
    assert is_past_or_current_slot(clock, date(2026, 10, 22), time(21, 58)) is True
    assert is_past_or_current_slot(clock, date(2026, 10, 22), time(22, 0)) is False
    assert is_past_or_current_slot(clock, date(2026, 10, 23), time(0, 0)) is False

    with pytest.raises(AppError) as exc:
        require_future_slot(clock, date(2026, 10, 22), time(21, 45))
    assert exc.value.code == "APPOINTMENT_TIME_PAST"


def test_availability_omits_elapsed_slots_but_keeps_future_slots() -> None:
    response = AvailabilityResponse(
        doctor_id=UUID("00000000-0000-0000-0000-000000000001"),
        date=date(2026, 10, 22),
        sessions=[
            AvailabilitySession(
                session_occurrence_id=None,
                session_definition_id=UUID("00000000-0000-0000-0000-000000000002"),
                materialized=False,
                name="Clinic session",
                start_time=time(0, 0),
                end_time=time(23, 45),
                status="AVAILABLE",
                slot_interval_minutes=15,
                maximum_capacity=96,
                used_capacity=0,
                remaining_capacity=96,
                slots=[
                    AvailabilitySlot(time=time(0, 0), available=True, normal_booking_allowed=True),
                    AvailabilitySlot(time=time(21, 45), available=True, normal_booking_allowed=True),
                    AvailabilitySlot(time=time(22, 0), available=True, normal_booking_allowed=True),
                    AvailabilitySlot(time=time(23, 45), available=True, normal_booking_allowed=True),
                ],
            )
        ],
    )

    result = apply_booking_time_rules(response, FrozenClock())
    assert [slot.time for slot in result.sessions[0].slots] == [time(22, 0), time(23, 45)]
