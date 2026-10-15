from datetime import date, time
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.modules.followups.models import FollowUpRecommendation
from app.modules.followups.schemas import (
    FollowUpBookRequest,
    FollowUpCloseRequest,
    FollowUpCreateInput,
    VisitCompleteRequest,
)
from app.modules.followups.service import FollowUpService


def test_followup_create_accepts_interval() -> None:
    item = FollowUpCreateInput(interval_days=7)
    assert item.interval_days == 7
    assert item.due_date is None


def test_followup_create_accepts_explicit_date() -> None:
    item = FollowUpCreateInput(due_date=date(2026, 10, 10))
    assert item.due_date == date(2026, 10, 10)
    assert item.interval_days is None


def test_followup_create_requires_exactly_one_due_method() -> None:
    with pytest.raises(ValidationError):
        FollowUpCreateInput()
    with pytest.raises(ValidationError):
        FollowUpCreateInput(interval_days=7, due_date=date(2026, 10, 10))


def test_visit_complete_allows_no_followup() -> None:
    request = VisitCompleteRequest(follow_up=None)
    assert request.follow_up is None


def test_followup_close_other_requires_note() -> None:
    with pytest.raises(ValidationError):
        FollowUpCloseRequest(reason="OTHER")


def test_followup_book_request_keeps_time() -> None:
    request = FollowUpBookRequest(
        session_definition_id="00000000-0000-0000-0000-000000000001",
        appointment_date=date(2026, 10, 10),
        appointment_time=time(10, 30),
    )
    assert request.appointment_time == time(10, 30)


def test_followup_model_has_unique_source_visit_and_linked_appointment() -> None:
    constraint_names = {
        constraint.name for constraint in FollowUpRecommendation.__table__.constraints
    }
    assert "uq_followups_source_visit" in constraint_names
    assert "uq_followups_linked_appointment" in constraint_names


def test_followup_booking_already_booked_rejected() -> None:
    db = MagicMock()
    clock = MagicMock()
    clock.clinic_date.return_value = date(2026, 10, 18)
    context = MagicMock()
    context.clinic_id = uuid4()

    service = FollowUpService(db, clock, context)

    # Mock idempotency to not have cached response
    mock_record = MagicMock()
    mock_record.response_body = None
    service._reserve_idempotency = MagicMock(return_value=mock_record)

    # Ownership discovery may observe OPEN; the locked recheck must reject BOOKED.
    service._followup = MagicMock(return_value=SimpleNamespace(
        patient_id=uuid4(), source_visit_id=uuid4(), status="OPEN"
    ))
    db.scalar.return_value = SimpleNamespace(doctor_id=uuid4())

    # Mock followup already in BOOKED state
    mock_followup = MagicMock()
    mock_followup.status = "BOOKED"
    service._locked_followup = MagicMock(return_value=mock_followup)

    request = FollowUpBookRequest(
        session_definition_id=uuid4(),
        appointment_date=date(2026, 10, 20),
        appointment_time=time(10, 0),
    )

    with pytest.raises(AppError) as exc_info:
        service.book(uuid4(), request, idempotency_key="test-key")
    assert exc_info.value.code == "FOLLOWUP_INVALID_STATE"
    assert exc_info.value.status_code == 409
    db.add.assert_not_called()


def test_followup_booking_past_date_rejected() -> None:
    db = MagicMock()
    clock = MagicMock()
    clock.clinic_date.return_value = date(2026, 10, 18)
    context = MagicMock()
    context.clinic_id = uuid4()

    service = FollowUpService(db, clock, context)

    mock_record = MagicMock()
    mock_record.response_body = None
    service._reserve_idempotency = MagicMock(return_value=mock_record)

    mock_followup = MagicMock()
    mock_followup.status = "OPEN"
    service._followup = MagicMock(return_value=mock_followup)

    request = FollowUpBookRequest(
        session_definition_id=uuid4(),
        appointment_date=date(2026, 10, 17),  # Past date
        appointment_time=time(10, 0),
    )

    with pytest.raises(AppError) as exc_info:
        service.book(uuid4(), request, idempotency_key="test-key")
    assert exc_info.value.code == "APPOINTMENT_DATE_PAST"
    assert exc_info.value.status_code == 422
