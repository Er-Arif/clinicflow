from datetime import UTC, datetime, time, timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.core.errors import AppError
from app.modules.scheduling.proposal_tokens import (
    create_proposal_token,
    decode_and_verify_proposal_token,
    normalize_proposal_hash,
)


def _session(*, order: int, name: str, start: time, end: time):
    return SimpleNamespace(
        display_order=order,
        session_name=name,
        start_time=start,
        end_time=end,
        slot_interval_minutes=15,
        maximum_capacity=12,
        active=True,
    )


def test_proposal_hash_is_canonical_for_weekday_and_session_order() -> None:
    morning = _session(order=1, name=" Morning ", start=time(9), end=time(12))
    afternoon = _session(order=2, name="Afternoon", start=time(13), end=time(15))

    first = normalize_proposal_hash([5, 0, 2], [afternoon, morning])
    second = normalize_proposal_hash([2, 5, 0], [morning, afternoon])

    assert first == second
    assert len(first) == 64


def test_proposal_token_round_trip_and_payload_binding() -> None:
    clinic_id = uuid4()
    doctor_id = uuid4()
    now = datetime(2026, 10, 25, 8, 0, tzinfo=UTC)
    expected_states = {"0": {"safe_date": "2026-10-26", "upcoming_version": None}}

    token = create_proposal_token(
        clinic_id=clinic_id,
        doctor_id=doctor_id,
        payload_hash="a" * 64,
        weekdays=[2, 0],
        expected_states=expected_states,
        now=now,
    )
    claims = decode_and_verify_proposal_token(
        token,
        clinic_id=clinic_id,
        doctor_id=doctor_id,
        expected_payload_hash="a" * 64,
        now=now,
    )

    assert claims["cid"] == str(clinic_id)
    assert claims["sub"] == str(doctor_id)
    assert claims["weekdays"] == [0, 2]
    assert claims["expected_states"] == expected_states

    with pytest.raises(AppError) as exc:
        decode_and_verify_proposal_token(
            token,
            clinic_id=clinic_id,
            doctor_id=doctor_id,
            expected_payload_hash="b" * 64,
            now=now,
        )
    assert exc.value.code == "STALE_SCHEDULE_PREVIEW"


def test_proposal_token_expires_after_ten_minutes() -> None:
    clinic_id = uuid4()
    doctor_id = uuid4()
    issued_at = datetime(2026, 10, 25, 8, 0, tzinfo=UTC)
    token = create_proposal_token(
        clinic_id=clinic_id,
        doctor_id=doctor_id,
        payload_hash="a" * 64,
        weekdays=[0],
        expected_states={},
        now=issued_at,
    )

    with pytest.raises(AppError) as exc:
        decode_and_verify_proposal_token(
            token,
            clinic_id=clinic_id,
            doctor_id=doctor_id,
            expected_payload_hash="a" * 64,
            now=issued_at + timedelta(minutes=11),
        )

    assert exc.value.code == "STALE_SCHEDULE_PREVIEW"
