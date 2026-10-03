from datetime import date, time

import pytest
from pydantic import ValidationError

from app.modules.followups.models import FollowUpRecommendation
from app.modules.followups.schemas import (
    FollowUpBookRequest,
    FollowUpCloseRequest,
    FollowUpCreateInput,
    VisitCompleteRequest,
)


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
    constraint_names = {constraint.name for constraint in FollowUpRecommendation.__table__.constraints}
    assert "uq_followups_source_visit" in constraint_names
    assert "uq_followups_linked_appointment" in constraint_names
