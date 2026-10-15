"""CF-18/19/20 persisted regressions; no host/device date assumptions."""

import os
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import func, inspect, select

from app.core.clock import SystemClock
from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.appointments.schemas import AppointmentCancelRequest, AppointmentRescheduleRequest
from app.modules.appointments.service import AppointmentService
from app.modules.audit.models import AuditEvent
from app.modules.audit.service import AuditService
from app.modules.clinic.models import Clinic
from app.modules.followups.models import FollowUpRecommendation
from app.modules.followups.schemas import (
    FollowUpBookRequest,
    FollowUpCloseRequest,
    FollowUpCreateInput,
    VisitCompleteRequest,
)
from app.modules.followups.service import FollowUpService
from app.modules.idempotency.models import IdempotencyRecord
from app.modules.messaging.defaults import DEFAULT_MESSAGE_TEMPLATES
from app.modules.messaging.models import MessageTemplate, Reminder
from app.modules.messaging.schemas import MessageTemplateUpdateRequest, SkipReminderRequest
from app.modules.messaging.service import ALLOWED_TEMPLATE_VARIABLES, ReminderService
from app.modules.patients.models import Patient
from app.modules.scheduling.models import ScheduleDefinition, SessionDefinition, SessionOccurrence
from app.modules.scheduling.schemas import (
    BlockScheduleExceptionRequest,
    UnblockScheduleExceptionRequest,
)
from app.modules.scheduling.service import SchedulingService
from app.modules.visits.service import VisitService
from tests.integration.test_effective_occupancy import Scenario
from tests.integration.test_transaction_concurrency import TARGET_DATE, _session_factory

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


def _followup(s):
    appointment = s.book()
    checked = s.run(lambda db: VisitService(db, s.clock, s.context).check_in(
        appointment.appointment_id, idempotency_key=str(uuid4())
    ))
    completed = s.run(lambda db: VisitService(db, s.clock, s.context).complete(
        checked.visit.visit_id,
        VisitCompleteRequest(follow_up=FollowUpCreateInput(due_date=TARGET_DATE)),
        idempotency_key=str(uuid4()),
    ))
    followup_id = completed.followup.followup_id
    with s.factory() as db:
        reminder_id = db.scalar(select(Reminder.reminder_id).where(Reminder.followup_id == followup_id))
    return followup_id, reminder_id


def _book(s, followup_id):
    return s.run(lambda db: FollowUpService(db, s.clock, s.context).book(
        followup_id, FollowUpBookRequest(
            session_definition_id=s.session_id, appointment_date=TARGET_DATE + timedelta(days=7),
            appointment_time=time(10),
        ), idempotency_key=str(uuid4()),
    )).appointment.appointment_id


def _cancel(s, appointment_id):
    return s.run(lambda db: AppointmentService(db, s.clock, s.context).cancel(
        appointment_id, AppointmentCancelRequest(reason="PATIENT_CANCELLED")
    ))


def _template(s, kind, language, body):
    def insert(db):
        template = MessageTemplate(
            clinic_id=s.case.clinic_id, template_type=kind, language=language,
            template_body=body, updated_by=s.case.user_id,
        )
        db.add(template)
        db.flush()
        return template.template_id
    return s.run(insert)


@pytest.mark.parametrize("kind,language,body", DEFAULT_MESSAGE_TEMPLATES)
def test_existing_templates_render_through_prepare(scenario, kind, language, body):
    s = scenario
    followup_id, followup_reminder = _followup(s)
    _template(s, kind, language, body)
    if kind == "FOLLOWUP_REMINDER":
        reminder_id = followup_reminder
    else:
        appointment_id = _book(s, followup_id)
        def insert(db):
            # Persist a task of each built-in type to exercise the shared renderer.
            reminder = Reminder(
                clinic_id=s.case.clinic_id, patient_id=s.case.patient_ids[0],
                appointment_id=appointment_id, reminder_type=kind, language=language,
                due_on=TARGET_DATE, status="DUE",
            ) if kind != "APPOINTMENT_REMINDER" else db.scalar(select(Reminder).where(
                Reminder.appointment_id == appointment_id, Reminder.reminder_type == kind
            ))
            db.add(reminder)
            db.flush()
            return reminder.reminder_id
        reminder_id = s.run(insert)
    prepared = s.run(lambda db: ReminderService(db, s.clock, s.context).prepare(reminder_id, language))
    assert "{" not in prepared.rendered_message
    assert prepared.reminder.language == language
    assert prepared.reminder.status == "DUE"  # Preparation never sends automatically.
    assert prepared.whatsapp_url.startswith("https://wa.me/")


@pytest.mark.parametrize("language", ["EN", "HI"])
def test_update_all_supported_variables_then_render_missing_context(scenario, language):
    s = scenario
    _, reminder_id = _followup(s)
    template_id = _template(s, "FOLLOWUP_REMINDER", language, "Original")
    names = sorted(ALLOWED_TEMPLATE_VARIABLES)
    body = "|".join("{" + name + "}" for name in names) + "|{{literal}}"
    s.run(lambda db: ReminderService(db, s.clock, s.context).update_template(
        template_id, MessageTemplateUpdateRequest(template_body=body, expected_version=1)
    ))
    s.run(lambda db: setattr(db.get(Patient, s.case.patient_ids[0]), "preferred_language", language))
    prepared = s.run(lambda db: ReminderService(db, s.clock, s.context).prepare(reminder_id))
    values = dict(zip(names, prepared.rendered_message.split("|")[:-1], strict=True))
    assert values["patient_name"] == "Integration Patient 1"
    assert values["doctor_name"] == "Dr Integration"
    assert values["followup_due_date"] == "05 Oct 2026"
    assert values["appointment_date"] == values["appointment_time"] == values["clinic_contact_number"] == ""
    assert prepared.rendered_message.endswith("|{literal}")
    assert prepared.reminder.language == language


@pytest.mark.parametrize("body", ["{PATIENT_NAME}", "{patient_name[0]}", "{patient_name!r}", "broken {"])
def test_update_and_persisted_legacy_template_fail_with_same_domain_error(scenario, body):
    s = scenario
    _, reminder_id = _followup(s)
    template_id = _template(s, "FOLLOWUP_REMINDER", "EN", body)
    with pytest.raises(AppError) as update_error:
        s.run(lambda db: ReminderService(db, s.clock, s.context).update_template(
            template_id, MessageTemplateUpdateRequest(template_body=body, expected_version=1)
        ))
    with pytest.raises(AppError) as render_error:
        s.run(lambda db: ReminderService(db, s.clock, s.context).prepare(reminder_id))
    assert render_error.value.code == update_error.value.code
    assert render_error.value.status_code == 422
    with s.factory() as db:
        assert db.get(MessageTemplate, template_id).template_body == body
        assert db.get(Reminder, reminder_id).message_snapshot is None


@pytest.mark.parametrize("prior", ["DUE", "SENT", "SKIPPED"])
def test_cancel_reopens_followup_and_only_booking_skipped_reminder(scenario, prior):
    s = scenario
    followup_id, reminder_id = _followup(s)
    _template(s, "FOLLOWUP_REMINDER", "EN", "Hello {patient_name}")
    s.run(lambda db: ReminderService(db, s.clock, s.context).prepare(reminder_id))
    if prior == "SENT":
        s.run(lambda db: ReminderService(db, s.clock, s.context).mark_sent(reminder_id))
    elif prior == "SKIPPED":
        s.run(lambda db: ReminderService(db, s.clock, s.context).skip(
            reminder_id, SkipReminderRequest(reason="Patient requested no reminder")
        ))
    with s.factory() as db:
        before = _row(db.get(Reminder, reminder_id))
    appointment_id = _book(s, followup_id)
    with s.factory() as db:
        assert db.get(FollowUpRecommendation, followup_id).status == "BOOKED"
        reminder = db.get(Reminder, reminder_id)
        if prior == "DUE":
            assert (reminder.status, reminder.skip_reason) == ("SKIPPED", "FOLLOWUP_BOOKED")
    _cancel(s, appointment_id)
    with s.factory() as db:
        followup = db.get(FollowUpRecommendation, followup_id)
        assert followup.status == "OPEN" and followup.linked_appointment_id is None
        assert followup.closed_at is None and followup.closed_by is None
        assert db.get(Appointment, appointment_id).status == "CANCELLED"
        reminder = db.get(Reminder, reminder_id)
        if prior == "DUE":
            assert reminder.status == "DUE"
            assert reminder.skipped_at is reminder.skipped_by is reminder.skip_reason is None
            assert reminder.message_snapshot is None
        else:
            assert _row(reminder) == before  # Delivery/manual-skip history is not erased.
        assert db.scalar(select(func.count()).select_from(Reminder).where(
            Reminder.followup_id == followup_id
        )) == 1
        worklist = FollowUpService(db, s.clock, s.context).list(state="DUE_TODAY")
        assert [row.followup_id for row in worklist.items] == [followup_id]
        assert not worklist.items[0].overdue
        reminders = ReminderService(db, s.clock, s.context).list(status="DUE", followup_id=followup_id)
        assert len(reminders.items) == (1 if prior == "DUE" else 0)
        if prior == "DUE":
            assert reminders.items[0].sendable
    s.clock = BoundaryClock("Asia/Kolkata", datetime(2026, 10, 6, 4, tzinfo=UTC))
    overdue = s.run(lambda db: FollowUpService(db, s.clock, s.context).list(state="OVERDUE"))
    assert overdue.items[0].followup_id == followup_id and overdue.items[0].overdue


def _row(item):
    return {attr.key: getattr(item, attr.key) for attr in inspect(type(item)).column_attrs}


def test_explicitly_closed_linked_record_is_not_resurrected(scenario):
    s = scenario
    followup_id, reminder_id = _followup(s)
    appointment_id = _book(s, followup_id)
    with pytest.raises(AppError, match="Only an open follow-up"):
        s.run(lambda db: FollowUpService(db, s.clock, s.context).close(
            followup_id, FollowUpCloseRequest(reason="NO_LONGER_REQUIRED")
        ))
    # The API forbids closing BOOKED. Exercise protection of a persisted CLOSED
    # linked row (schema permits it) without adding a new closure transition.
    with s.factory.begin() as db:
        followup = db.get(FollowUpRecommendation, followup_id)
        followup.status = "CLOSED"
        followup.closed_at = s.clock.now_utc()
        followup.closed_by = s.case.user_id
        followup.close_reason = "NO_LONGER_REQUIRED"
        db.flush()
        before = _row(followup)
        reminder_before = _row(db.get(Reminder, reminder_id))
    _cancel(s, appointment_id)
    with s.factory() as db:
        assert _row(db.get(FollowUpRecommendation, followup_id)) == before
        assert _row(db.get(Reminder, reminder_id)) == reminder_before


def test_reschedule_keeps_followup_booked_and_reminder_skipped(scenario):
    s = scenario
    followup_id, reminder_id = _followup(s)
    appointment_id = _book(s, followup_id)
    result = s.run(lambda db: AppointmentService(db, s.clock, s.context).reschedule(
        appointment_id, AppointmentRescheduleRequest(
            new_session_definition_id=s.session_id, new_appointment_date=TARGET_DATE + timedelta(days=7),
            new_appointment_time=time(10, 30),
        ), idempotency_key=str(uuid4()),
    ))
    with s.factory() as db:
        followup = db.get(FollowUpRecommendation, followup_id)
        assert followup.status == "BOOKED"
        replacement = db.get(Appointment, followup.linked_appointment_id)
        assert replacement.appointment_id != appointment_id
        assert replacement.rescheduled_from_appointment_id == appointment_id
        assert replacement.status == "BOOKED"
        original = db.get(Appointment, appointment_id)
        assert (original.status, original.cancellation_reason) == ("CANCELLED", "RESCHEDULED")
        assert db.get(Reminder, reminder_id).skip_reason == "FOLLOWUP_BOOKED"
        assert not db.scalar(select(AuditEvent.audit_id).where(
            AuditEvent.entity_id == followup_id, AuditEvent.action_type == "FOLLOWUP_REOPENED"
        ))
    assert result is not None


def test_manual_close_preserves_explicit_decision(scenario):
    s = scenario
    followup_id, reminder_id = _followup(s)
    s.run(lambda db: FollowUpService(db, s.clock, s.context).close(
        followup_id, FollowUpCloseRequest(reason="PATIENT_DECLINED")
    ))
    with s.factory() as db:
        followup = db.get(FollowUpRecommendation, followup_id)
        assert followup.status == "CLOSED" and followup.close_reason == "PATIENT_DECLINED"
        assert followup.closed_by == s.case.user_id and followup.closed_at is not None
        assert db.get(Reminder, reminder_id).skip_reason == "FOLLOWUP_CLOSED"
        assert not FollowUpService(db, s.clock, s.context).list(state="OPEN").items
    with pytest.raises(AppError) as error:
        _book(s, followup_id)
    assert error.value.code == "FOLLOWUP_INVALID_STATE"


@pytest.mark.parametrize("valid", [True, False])
def test_bootstrap_template_creation_uses_same_validation(scenario, monkeypatch, valid):
    from scripts import bootstrap_owner

    clinic_name = f"Template validation {uuid4()}"
    monkeypatch.setattr(sys, "argv", [
        "bootstrap_owner", "--clinic-name", clinic_name, "--owner-name", "Test Owner",
        "--login", uuid4().hex, "--password", "test-only-password",
    ])
    monkeypatch.setattr(bootstrap_owner, "get_session_factory", lambda: scenario.factory)
    if not valid:
        monkeypatch.setattr(bootstrap_owner, "DEFAULT_MESSAGE_TEMPLATES", [
            ("FOLLOWUP_REMINDER", "EN", "{patient_name[0]}"),
        ])
        with pytest.raises(AppError) as error:
            bootstrap_owner.main()
        assert error.value.code == "UNSUPPORTED_TEMPLATE_VARIABLE"
    else:
        bootstrap_owner.main()
    with scenario.factory() as db:
        clinic = db.scalar(select(Clinic).where(Clinic.clinic_name == clinic_name))
        if valid:
            assert db.scalar(select(func.count()).select_from(MessageTemplate).where(
                MessageTemplate.clinic_id == clinic.clinic_id
            )) == len(DEFAULT_MESSAGE_TEMPLATES)
        else:
            assert clinic is None  # A bad creation template rolls back bootstrap.


@pytest.mark.parametrize("reschedule", [False, True])
def test_linked_mutation_failure_rolls_back_all_state(scenario, monkeypatch, reschedule):
    s = scenario
    followup_id, _ = _followup(s)
    appointment_id = _book(s, followup_id)
    def snapshot():
        with s.factory() as db:
            return {
                model.__name__: sorted([
                    repr(_row(row)) for row in db.scalars(select(model).where(
                        model.clinic_id == s.case.clinic_id
                    ))
                ]) for model in (Appointment, FollowUpRecommendation, Reminder, AuditEvent, IdempotencyRecord)
            }
    def mutate():
        if not reschedule:
            return _cancel(s, appointment_id)
        return s.run(lambda db: AppointmentService(db, s.clock, s.context).reschedule(
            appointment_id, AppointmentRescheduleRequest(
                new_session_definition_id=s.session_id,
                new_appointment_date=TARGET_DATE + timedelta(days=7), new_appointment_time=time(10, 30),
            ), idempotency_key=str(uuid4()),
        ))
    before = snapshot()
    original = AuditService.record
    def fail(self, **kwargs):
        result = original(self, **kwargs)
        if kwargs["action_type"] == ("APPOINTMENT_RESCHEDULED" if reschedule else "APPOINTMENT_CANCELLED"):
            self.db.flush()
            raise RuntimeError("Injected lifecycle failure")
        return result
    with monkeypatch.context() as patch:
        patch.setattr(AuditService, "record", fail)
        with pytest.raises(RuntimeError, match="Injected lifecycle failure"):
            mutate()
    assert snapshot() == before
    mutate()


@dataclass(frozen=True, slots=True)
class BoundaryClock(SystemClock):
    instant: datetime

    def now_utc(self):
        return self.instant


@pytest.mark.parametrize("zone,instant", [
    ("Asia/Kolkata", datetime(2026, 10, 4, 20, tzinfo=UTC)),
    ("America/Los_Angeles", datetime(2026, 10, 6, 3, tzinfo=UTC)),
])
def test_exception_default_boundary_and_explicit_dates(scenario, zone, instant):
    s = scenario
    s.clock = BoundaryClock(zone, instant)
    assert s.clock.clinic_date() == TARGET_DATE != instant.date()
    dates = [TARGET_DATE + timedelta(days=offset) for offset in (-1, 0, 1)]
    with s.factory.begin() as db:
        for day in (dates[0], dates[2]):
            definition = ScheduleDefinition(
                clinic_id=s.case.clinic_id, doctor_id=s.case.doctor_id,
                weekday=day.weekday(), effective_from=date(2026, 10, 1),
                active=True, created_by=s.case.user_id,
            )
            db.add(definition)
            db.flush()
            db.add(SessionDefinition(
                clinic_id=s.case.clinic_id, schedule_definition_id=definition.schedule_definition_id,
                session_name="Morning", start_time=time(10), end_time=time(11),
                slot_interval_minutes=30, maximum_capacity=2, active=True, display_order=0,
            ))
    blocked = []
    for day in dates:
        blocked.append(s.run(lambda db, day=day: SchedulingService(db, s.clock, s.context).block_exception(
            s.case.doctor_id, BlockScheduleExceptionRequest(date=day, scope="FULL_DAY", reason="Leave")
        )))
    with s.factory() as db:
        service = SchedulingService(db, s.clock, s.context)
        assert [item.date for item in service.list_exceptions(s.case.doctor_id).exceptions] == dates[1:]
        history = service.list_exceptions(s.case.doctor_id, from_date=dates[0]).exceptions
        assert [item.date for item in history] == dates
        assert [item.date for item in history if item.date < s.clock.clinic_date()] == dates[:1]
        assert [item.date for item in service.list_exceptions(s.case.doctor_id, dates[2]).exceptions] == dates[2:]
        for day, item in zip(dates, blocked, strict=True):
            assert item.date == day
            assert db.get(SessionOccurrence, item.occurrence_ids[0]).occurrence_date == day
    result = s.run(lambda db: SchedulingService(db, s.clock, s.context).unblock_exceptions(
        s.case.doctor_id, UnblockScheduleExceptionRequest(occurrence_ids=blocked[1].occurrence_ids)
    ))
    assert result.unblocked_count == 1
    remaining = s.run(lambda db: SchedulingService(db, s.clock, s.context).list_exceptions(s.case.doctor_id))
    assert [item.date for item in remaining.exceptions] == dates[2:]
