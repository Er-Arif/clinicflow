"""Regression coverage for completing visits with no-contact patients."""

import os
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

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
