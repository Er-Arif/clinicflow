from datetime import time
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.modules.scheduling.schemas import (
    FeeConfigurationCreateRequest,
    SchedulePreviewImpactRequest,
    SessionWrite,
)
from app.modules.scheduling.service import generate_slots


def test_only_approved_recurring_schedule_mutations_are_exposed() -> None:
    paths = app.openapi()["paths"]
    schedule_path = "/api/v1/doctors/{doctor_id}/schedule"
    assert "get" in paths[schedule_path]
    assert "put" not in paths[schedule_path]
    assert f"{schedule_path}/{{weekday}}" not in paths
    assert "post" in paths[f"{schedule_path}/preview-impact"]
    assert "put" in paths[f"{schedule_path}/smart-apply"]


@pytest.mark.parametrize(("suffix", "status_code"), [("", 405), ("/0", 404)])
def test_legacy_schedule_mutation_routes_are_retired(suffix: str, status_code: int) -> None:
    doctor_id = "00000000-0000-0000-0000-000000000001"
    with TestClient(app) as client:
        response = client.put(
            f"/api/v1/doctors/{doctor_id}/schedule{suffix}",
            json={"weekdays": [0], "effective_from": "2026-10-05", "sessions": []},
        )
    assert response.status_code == status_code


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


def test_multiday_preview_request_validation() -> None:
    # Valid multi-day request
    req = SchedulePreviewImpactRequest(
        weekdays=[0, 2, 4],
        sessions=[],
    )
    assert req.weekdays == [0, 2, 4]

    # Duplicate weekdays rejected
    with pytest.raises(ValidationError):
        SchedulePreviewImpactRequest(
            weekdays=[0, 1, 0],
            sessions=[],
        )

    # Out-of-range weekday rejected
    with pytest.raises(ValidationError):
        SchedulePreviewImpactRequest(
            weekdays=[0, 7],
            sessions=[],
        )

    # Empty weekdays rejected
    with pytest.raises(ValidationError):
        SchedulePreviewImpactRequest(
            weekdays=[],
            sessions=[],
        )
