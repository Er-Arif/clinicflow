"""Stable limit/offset ordering when operational worklists exceed one page."""

import os
from datetime import time
from uuid import uuid4

import pytest
from sqlalchemy import select, update

from app.modules.followups.models import FollowUpRecommendation
from app.modules.followups.schemas import (
    FollowUpCloseRequest,
    FollowUpCreateInput,
    VisitCompleteRequest,
)
from app.modules.followups.service import FollowUpService
from app.modules.messaging.models import Reminder
from app.modules.messaging.service import ReminderService
from app.modules.scheduling.models import SessionDefinition, SessionOccurrence
from app.modules.visits.service import VisitService
from tests.integration.test_effective_occupancy import Scenario
from tests.integration.test_transaction_concurrency import TARGET_DATE, _session_factory

pytestmark = pytest.mark.skipif(
    os.getenv("CLINICFLOW_RUN_INTEGRATION") != "1", reason="Requires migrated PostgreSQL."
)


@pytest.fixture(scope="module")
def worklists():
    factory, engine = _session_factory()
    try:
        s = Scenario(factory)
        with factory.begin() as db:
            definition = db.get(SessionDefinition, s.session_id)
            definition.maximum_capacity = 60
            definition.slot_interval_minutes = 1
            occurrence = db.get(SessionOccurrence, s.case.occurrence_id)
            occurrence.maximum_capacity_snapshot = 60
            occurrence.slot_interval_minutes_snapshot = 1
        ids = []
        for minute in range(56):
            appointment = s.book(at=time(10, minute), patient=s.patient())
            checked = s.run(lambda db, appointment=appointment: VisitService(db, s.clock, s.context).check_in(
                appointment.appointment_id, idempotency_key=str(uuid4())
            ))
            result = s.run(lambda db, checked=checked: VisitService(db, s.clock, s.context).complete(
                checked.visit.visit_id,
                VisitCompleteRequest(follow_up=FollowUpCreateInput(due_date=TARGET_DATE)),
                idempotency_key=str(uuid4()),
            ))
            ids.append(result.followup.followup_id)
        s.run(lambda db: FollowUpService(db, s.clock, s.context).close(
            ids[0], FollowUpCloseRequest(reason="NO_LONGER_REQUIRED")
        ))
        # Deliberately tie every prior sort key, as can happen in batch imports or
        # one transaction. IDs must define a total order across page boundaries.
        with factory.begin() as db:
            for model in (FollowUpRecommendation, Reminder):
                db.execute(update(model).where(model.clinic_id == s.case.clinic_id)
                           .values(created_at=s.clock.now_utc()))
        yield s
    finally:
        engine.dispose()


@pytest.mark.parametrize("kind", ["followups", "reminders"])
def test_all_matching_rows_reachable_once_in_deterministic_order(worklists, kind):
    s = worklists
    with s.factory() as db:
        if kind == "followups":
            service = FollowUpService(db, s.clock, s.context)
            filters = {"state": "DUE_TODAY"}
            field = "followup_id"
            expected = list(db.scalars(select(FollowUpRecommendation.followup_id).where(
                FollowUpRecommendation.clinic_id == s.case.clinic_id,
                FollowUpRecommendation.status == "OPEN",
            ).order_by(FollowUpRecommendation.followup_id)))
        else:
            service = ReminderService(db, s.clock, s.context)
            filters = {"status": "DUE", "due_through": TARGET_DATE}
            field = "reminder_id"
            expected = list(db.scalars(select(Reminder.reminder_id).where(
                Reminder.clinic_id == s.case.clinic_id, Reminder.status == "DUE",
            ).order_by(Reminder.reminder_id)))
        first = service.list(**filters)
        second = service.list(**filters, offset=50)
        empty = service.list(**filters, offset=55)
        assert first.total == second.total == empty.total == 55
        assert (first.limit, first.offset, second.offset) == (50, 0, 50)
        assert (len(first.items), len(second.items), len(empty.items)) == (50, 5, 0)
        actual = [getattr(row, field) for row in first.items + second.items]
        assert actual == expected and len(set(actual)) == 55
        assert [getattr(row, field) for row in service.list(**filters).items] == actual[:50]
