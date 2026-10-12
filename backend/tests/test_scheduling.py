from datetime import date, time
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.modules.scheduling.schemas import (
    FeeConfigurationCreateRequest,
    MultiDayScheduleReplaceRequest,
    SessionWrite,
)
from app.modules.scheduling.service import generate_slots


def test_slot_generation_is_end_exclusive() -> None:
    assert generate_slots(time(10, 0), time(11, 0), 15) == [
        time(10, 0),
        time(10, 15),
        time(10, 30),
        time(10, 45),
    ]


def test_session_capacity_cannot_exceed_generated_slots() -> None:
    with pytest.raises(ValidationError):
        SessionWrite(
            session_name="Morning",
            start_time=time(10, 0),
            end_time=time(11, 0),
            slot_interval_minutes=15,
            maximum_capacity=5,
        )


def test_session_capacity_can_be_lower_than_generated_slots() -> None:
    value = SessionWrite(
        session_name="Morning",
        start_time=time(10, 0),
        end_time=time(11, 0),
        slot_interval_minutes=15,
        maximum_capacity=3,
    )
    assert value.maximum_capacity == 3


def test_fee_values_are_quantized() -> None:
    request = FeeConfigurationCreateRequest(
        effective_from="2026-10-03",
        regular_fee=Decimal("500"),
        followup_fee=Decimal("300.5"),
    )
    assert request.regular_fee == Decimal("500.00")
    assert request.followup_fee == Decimal("300.50")


def test_multiday_schedule_request_validation() -> None:
    # Valid multi-day request
    req = MultiDayScheduleReplaceRequest(
        weekdays=[0, 2, 4],
        effective_from=date(2026, 10, 15),
        sessions=[],
    )
    assert req.weekdays == [0, 2, 4]

    # Duplicate weekdays rejected
    with pytest.raises(ValidationError):
        MultiDayScheduleReplaceRequest(
            weekdays=[0, 1, 0],
            effective_from=date(2026, 10, 15),
            sessions=[],
        )

    # Out-of-range weekday rejected
    with pytest.raises(ValidationError):
        MultiDayScheduleReplaceRequest(
            weekdays=[0, 7],
            effective_from=date(2026, 10, 15),
            sessions=[],
        )

    # Empty weekdays rejected
    with pytest.raises(ValidationError):
        MultiDayScheduleReplaceRequest(
            weekdays=[],
            effective_from=date(2026, 10, 15),
            sessions=[],
        )
