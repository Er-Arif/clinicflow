"""Regression coverage for follow-up completion edge cases."""

import os
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.followups.models import FollowUpRecommendation
from app.modules.followups.schemas import FollowUpCreateInput, VisitCompleteRequest
from app.modules.messaging.models import Reminder
from app.modules.patients.models import Patient
from app.modules.visits.models import Visit
from app.modules.visits.service import VisitService
from tests.integration.test_effective_occupancy import Scenario
from tests.integration.test_transaction_concurrency import _session_factory

pytestmark = pytest.mark.skipif(
    os.getenv("CLINICFLOW_RUN_INTEGRATION") != "1", reason="Requires migrated PostgreSQL."
)


@pytest.fixture
def scenario():
    factory, engine = _session_factory()
    try:
        yield Scenario(factory)
    finally:
        engine.dispose()


class NextDayClock:
    def __init__(self, base):
        self.base = base

    def now_utc(self):
        return self.base.now_utc() + timedelta(days=1)

    def clinic_now(self):
        return self.base.clinic_now() + timedelta(days=1)

    def clinic_date(self):
        return self.base.clinic_date() + timedelta(days=1)


def test_complete_visit_with_followup_allows_patient_without_phone(scenario):
    s = scenario
    patient_id = s.case.patient_ids[0]

    def remove_messaging_contact(db):
        patient = db.get(Patient, patient_id)
        patient.mobile_e164 = None
        patient.whatsapp_e164 = None
        patient.whatsapp_same_as_mobile = False
        patient.reminders_enabled = False

    s.run(remove_messaging_contact)
    appointment = s.book()
    checked = s.run(
        lambda db: VisitService(db, s.clock, s.context).check_in(
            appointment.appointment_id, idempotency_key=str(uuid4())
        )
    )
    completed = s.run(
        lambda db: VisitService(db, s.clock, s.context).complete(
            checked.visit.visit_id,
            VisitCompleteRequest(follow_up=FollowUpCreateInput(interval_days=7)),
            idempotency_key=str(uuid4()),
        )
    )

    assert completed.visit_status == "COMPLETED"
    assert completed.appointment.status == "COMPLETED"
    assert completed.followup is not None
    assert completed.followup.patient.mobile_number is None
    assert completed.followup.interval_days == 7
    assert completed.followup.due_date == s.clock.clinic_date() + timedelta(days=7)

    with s.factory() as db:
        followup = db.get(FollowUpRecommendation, completed.followup.followup_id)
        assert followup is not None
        assert followup.status == "OPEN"
        assert db.get(Appointment, appointment.appointment_id).status == "COMPLETED"
        assert db.get(Visit, checked.visit.visit_id).status == "COMPLETED"
        assert db.scalar(
            select(Reminder.reminder_id).where(Reminder.followup_id == followup.followup_id)
        ) is None


def test_previous_day_opd_visit_requires_reason_and_keeps_followup_on_service_date(scenario):
    s = scenario
    appointment = s.book()
    checked = s.run(
        lambda db: VisitService(db, s.clock, s.context).check_in(
            appointment.appointment_id, idempotency_key=str(uuid4())
        )
    )
    late_clock = NextDayClock(s.clock)

    with pytest.raises(AppError) as error:
        s.run(
            lambda db: VisitService(db, late_clock, s.context).complete(
                checked.visit.visit_id,
                VisitCompleteRequest(follow_up=FollowUpCreateInput(interval_days=7)),
                idempotency_key=str(uuid4()),
            )
        )
    assert error.value.code == "VISIT_LATE_COMPLETION_REASON_REQUIRED"

    completed = s.run(
        lambda db: VisitService(db, late_clock, s.context).complete(
            checked.visit.visit_id,
            VisitCompleteRequest(
                follow_up=FollowUpCreateInput(interval_days=7),
                late_completion_reason="Forgot to close the visit before end of day",
            ),
            idempotency_key=str(uuid4()),
        )
    )

    assert completed.visit_status == "COMPLETED"
    assert completed.followup is not None
    assert completed.followup.source_visit_date == s.clock.clinic_date()
    assert completed.followup.due_date == s.clock.clinic_date() + timedelta(days=7)
    assert completed.followup.due_date != late_clock.clinic_date() + timedelta(days=7)
    assert completed.completed_at == late_clock.now_utc()
