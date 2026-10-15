"""CF-06: real PostgreSQL collision protection and authorized-overlap lifecycle."""

import os
from dataclasses import replace
from datetime import time, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.appointments.schemas import AppointmentCancelRequest
from app.modules.appointments.service import AppointmentService
from app.modules.audit.models import AuditEvent
from app.modules.clinic.models import Doctor
from app.modules.followups.schemas import VisitCompleteRequest
from app.modules.scheduling.models import ScheduleDefinition, SessionDefinition, SessionOccurrence
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
        s = Scenario(factory)
        s.context = replace(
            s.context, permissions=s.context.permissions | {"appointment.capacity_override"}
        )
        yield s
    finally:
        engine.dispose()


def pair(s):
    ordinary = s.book()
    authorized = s.book(patient=s.case.patient_ids[1], override=True)
    return ordinary, authorized


def direct_insert(s, *, occurrence_id=None, at=time(10), status="BOOKED"):
    """Bypass Python booking validation to exercise the actual database guard."""

    def insert(db):
        occurrence = db.get(SessionOccurrence, occurrence_id or s.case.occurrence_id)
        row = Appointment(
            clinic_id=s.case.clinic_id,
            doctor_id=occurrence.doctor_id,
            patient_id=s.case.patient_ids[1],
            session_occurrence_id=occurrence.session_occurrence_id,
            appointment_time=at,
            appointment_type="REGULAR",
            booking_source="ASSISTANT",
            status=status,
            base_fee_snapshot=500,
            effective_fee_amount=500,
            created_by=s.case.user_id,
        )
        db.add(row)
        db.flush()
        return row.appointment_id

    return s.run(insert)


def direct_update(s, appointment_id, **values):
    s.run(
        lambda db: db.execute(
            update(Appointment).where(Appointment.appointment_id == appointment_id).values(**values)
        )
    )


def assert_collision(operation):
    with pytest.raises(IntegrityError) as error:
        operation()
    assert error.value.orig.sqlstate == "23505"
    assert error.value.orig.diag.message_primary == "normal appointment slot already occupied"


def anchor(s, appointment_id):
    row, _ = s.snapshot(appointment_id)
    return tuple(
        row[key]
        for key in (
            "appointment_id",
            "clinic_id",
            "doctor_id",
            "session_occurrence_id",
            "appointment_time",
        )
    )


@pytest.mark.parametrize("override_first", [False, True])
def test_both_bookings_complete_through_real_services_without_rewriting_anchors(
    scenario, override_first
):
    s = scenario
    ordinary, authorized = pair(s)
    ordered = [authorized, ordinary] if override_first else [ordinary, authorized]
    before = {row.appointment_id: anchor(s, row.appointment_id) for row in ordered}
    authorization = s.snapshot(authorized.appointment_id)[0]
    assert authorization["capacity_override_used"] is True
    assert authorization["capacity_override_by"] == s.case.user_id
    assert authorization["capacity_override_at"] is not None
    assert authorization["capacity_override_reason"]
    for row in ordered:
        checkin = s.run(
            lambda db, row=row: VisitService(db, s.clock, s.context).check_in(
                row.appointment_id, idempotency_key=str(uuid4())
            )
        )
        assert s.snapshot(row.appointment_id)[0]["status"] == "CHECKED_IN"
        s.run(
            lambda db, checkin=checkin: VisitService(db, s.clock, s.context).complete(
                checkin.visit.visit_id, VisitCompleteRequest(), idempotency_key=str(uuid4())
            )
        )
        assert s.snapshot(row.appointment_id)[0]["status"] == "COMPLETED"
        assert anchor(s, row.appointment_id) == before[row.appointment_id]
    rows = s.run(
        lambda db: list(
            db.scalars(
                select(Appointment.appointment_id).where(Appointment.clinic_id == s.case.clinic_id)
            )
        )
    )
    assert set(rows) == set(before)
    after = s.snapshot(authorized.appointment_id)[0]
    for key in authorization:
        if key.startswith("capacity_override_") or key.startswith("override_"):
            assert after[key] == authorization[key]
    audits = s.run(
        lambda db: list(
            db.scalars(
                select(AuditEvent).where(
                    AuditEvent.clinic_id == s.case.clinic_id,
                    AuditEvent.action_type == "CAPACITY_OVERRIDE",
                )
            )
        )
    )
    assert len(audits) == 1
    assert audits[0].reason == authorization["capacity_override_reason"]


@pytest.mark.parametrize("existing", ["ordinary", "pair", "override_only"])
def test_direct_ordinary_insert_rejected_even_when_only_override_occupies_slot(scenario, existing):
    s = scenario
    if existing == "ordinary":
        s.book()
    else:
        ordinary, _ = pair(s)
        if existing == "override_only":
            s.run(
                lambda db: AppointmentService(db, s.clock, s.context).cancel(
                    ordinary.appointment_id, AppointmentCancelRequest(reason="PATIENT_CANCELLED")
                )
            )
    assert_collision(lambda: direct_insert(s))


def other_occurrence(s, change):
    def seed(db):
        original = db.get(SessionOccurrence, s.case.occurrence_id)
        doctor_id = s.case.doctor_id
        session_id = s.case.session_definition_id
        if change in {"session", "doctor"}:
            definition = db.get(SessionDefinition, session_id)
            schedule_id = definition.schedule_definition_id
            if change == "doctor":
                doctor = Doctor(
                    clinic_id=s.case.clinic_id, display_name="Other doctor", active=True
                )
                db.add(doctor)
                db.flush()
                doctor_id = doctor.doctor_id
                schedule = ScheduleDefinition(
                    clinic_id=s.case.clinic_id,
                    doctor_id=doctor_id,
                    weekday=0,
                    effective_from=TARGET_DATE,
                    active=True,
                    created_by=s.case.user_id,
                )
                db.add(schedule)
                db.flush()
                schedule_id = schedule.schedule_definition_id
            session = SessionDefinition(
                clinic_id=s.case.clinic_id,
                schedule_definition_id=schedule_id,
                session_name="Other session",
                start_time=time(10),
                end_time=time(11),
                slot_interval_minutes=30,
                maximum_capacity=2,
                active=True,
                display_order=1,
            )
            db.add(session)
            db.flush()
            session_id = session.session_definition_id
        occurrence = SessionOccurrence(
            clinic_id=s.case.clinic_id,
            doctor_id=doctor_id,
            session_definition_id=session_id,
            occurrence_date=TARGET_DATE + timedelta(days=7) if change == "date" else TARGET_DATE,
            session_name_snapshot="Other occurrence",
            start_time_snapshot=original.start_time_snapshot,
            end_time_snapshot=original.end_time_snapshot,
            slot_interval_minutes_snapshot=30,
            maximum_capacity_snapshot=2,
            status="AVAILABLE",
        )
        db.add(occurrence)
        db.flush()
        return occurrence.session_occurrence_id

    return s.run(seed)


@pytest.mark.parametrize("change", ["time", "date", "session", "doctor", "untimed"])
def test_direct_move_into_occupied_position_rejected_and_rolled_back(scenario, change):
    s = scenario
    s.book()
    source = other_occurrence(s, change) if change in {"date", "session", "doctor"} else None
    at = None if change == "untimed" else time(10, 30) if change == "time" else time(10)
    moving = direct_insert(s, occurrence_id=source, at=at)
    before = s.snapshot(moving)
    values = (
        {"session_occurrence_id": s.case.occurrence_id, "doctor_id": s.case.doctor_id}
        if source
        else {"appointment_time": time(10)}
    )
    assert_collision(lambda: direct_update(s, moving, **values))
    assert s.snapshot(moving) == before


def test_moving_authorized_row_preserves_its_own_override_exception(scenario):
    s = scenario
    _, authorized = pair(s)
    direct_update(s, authorized.appointment_id, appointment_time=time(10, 30))
    direct_update(s, authorized.appointment_id, appointment_time=time(10))
    assert s.snapshot(authorized.appointment_id)[0]["capacity_override_used"] is True
    assert_collision(lambda: direct_insert(s))


@pytest.mark.parametrize("status", ["BOOKED", "CHECKED_IN", "COMPLETED"])
def test_direct_reactivation_requires_collision_check(scenario, status):
    s = scenario
    pair(s)
    cancelled = direct_insert(s, status="CANCELLED")
    assert_collision(lambda: direct_update(s, cancelled, status=status))
    assert s.snapshot(cancelled)[0]["status"] == "CANCELLED"


@pytest.mark.parametrize("checked_in", [False, True])
def test_cancellation_remains_allowed_with_authorized_overlap(scenario, checked_in):
    s = scenario
    ordinary, authorized = pair(s)
    if checked_in:
        s.run(
            lambda db: VisitService(db, s.clock, s.context).check_in(
                ordinary.appointment_id, idempotency_key=str(uuid4())
            )
        )
    before = anchor(s, ordinary.appointment_id)
    s.run(
        lambda db: AppointmentService(db, s.clock, s.context).cancel(
            ordinary.appointment_id, AppointmentCancelRequest(reason="PATIENT_CANCELLED")
        )
    )
    assert s.snapshot(ordinary.appointment_id)[0]["status"] == "CANCELLED"
    assert anchor(s, ordinary.appointment_id) == before
    assert s.snapshot(authorized.appointment_id)[0]["status"] == "BOOKED"


def test_removing_override_authorization_from_conflicting_row_is_rejected(scenario):
    s = scenario
    _, authorized = pair(s)
    before = s.snapshot(authorized.appointment_id)
    # Clear metadata as well, so the collision trigger, not the metadata check,
    # must reject the dangerous direction.
    assert_collision(
        lambda: direct_update(
            s,
            authorized.appointment_id,
            capacity_override_used=False,
            capacity_override_by=None,
            capacity_override_at=None,
            capacity_override_reason=None,
            override_capacity_snapshot=None,
            override_existing_count=None,
        )
    )
    assert s.snapshot(authorized.appointment_id) == before


def test_noop_updates_and_direct_lifecycle_updates_preserve_authorized_overlap(scenario):
    s = scenario
    ordinary, _ = pair(s)
    before = anchor(s, ordinary.appointment_id)
    for status in ("BOOKED", "CHECKED_IN", "COMPLETED"):
        direct_update(
            s,
            ordinary.appointment_id,
            status=status,
            appointment_time=time(10),
            session_occurrence_id=s.case.occurrence_id,
            capacity_override_used=False,
        )
        assert anchor(s, ordinary.appointment_id) == before
    assert_collision(lambda: direct_insert(s))


def test_cancelled_slot_can_be_reused_and_nonconflicting_reactivation_is_allowed(scenario):
    s = scenario
    original = s.book()
    direct_update(s, original.appointment_id, status="CANCELLED")
    direct_insert(s)
    cancelled = direct_insert(s, at=time(10, 30), status="CANCELLED")
    direct_update(s, cancelled, status="BOOKED")
    assert s.snapshot(cancelled)[0]["status"] == "BOOKED"


def test_service_still_requires_override_permission(scenario):
    s = scenario
    s.book()
    s.context = replace(
        s.context, permissions=s.context.permissions - {"appointment.capacity_override"}
    )
    with pytest.raises(AppError) as error:
        s.book(patient=s.case.patient_ids[1], override=True)
    assert error.value.code == "PERMISSION_DENIED"
