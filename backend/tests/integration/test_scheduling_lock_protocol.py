from __future__ import annotations

import os
import time as wall_time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import time, timedelta
from queue import Queue
from threading import Event
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select, text

from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.appointments.schemas import (
    AppointmentCancelRequest,
    AppointmentRescheduleRequest,
    CapacityOverrideInput,
)
from app.modules.appointments.service import AppointmentService
from app.modules.followups.models import FollowUpRecommendation
from app.modules.followups.schemas import (
    FollowUpBookRequest,
    FollowUpCreateInput,
    VisitCompleteRequest,
)
from app.modules.followups.service import FollowUpService
from app.modules.scheduling.concurrency import _doctor_date_lock_key
from app.modules.scheduling.models import ScheduleDefinition, SessionDefinition, SessionOccurrence
from app.modules.scheduling.schemas import (
    BlockScheduleExceptionRequest,
    BlockSessionRequest,
    SchedulePreviewImpactRequest,
    SessionWrite,
    SmartScheduleApplyRequest,
    UnblockScheduleExceptionRequest,
)
from app.modules.scheduling.service import SchedulingService
from app.modules.visits.schemas import WalkInRequest
from app.modules.visits.service import VisitService
from tests.integration.test_transaction_concurrency import (
    TARGET_DATE,
    FrozenClock,
    _context,
    _create_request,
    _run_with_request_id,
    _seed_case,
    _session_factory,
)

pytestmark = pytest.mark.skipif(
    os.getenv("CLINICFLOW_RUN_INTEGRATION") != "1",
    reason="Requires migrated PostgreSQL and CLINICFLOW_RUN_INTEGRATION=1.",
)


@pytest.fixture
def case_db():
    factory, engine = _session_factory()
    case = _seed_case(factory, capacity=2)
    try:
        yield factory, engine, case
    finally:
        engine.dispose()


def _transaction(factory, operation):
    def run():
        with factory.begin() as db:
            return operation(db)

    return _run_with_request_id(run)


def _controlled_race(factory, engine, key, first, second, *, pause_on_patient=False):
    """Pause first after a real lock; observe second blocked in PostgreSQL.

    A missing lock cannot pass by finishing quickly. A lock inversion fails with a
    database deadlock/timeout, not a hung test. Domain conflicts roll back normally.
    """
    held, release = Event(), Event()
    first_pid, second_pid = Queue(), Queue()

    def pause_after_lock(conn, cursor, statement, parameters, context, executemany):
        at_lock = (
            "FROM patients" in statement and "FOR UPDATE" in statement
            if pause_on_patient
            else "pg_advisory_xact_lock(" in statement and parameters.get("key") == key
        )
        if conn.info.get("protocol_test_role") == "first" and not held.is_set() and at_lock:
            held.set()
            assert release.wait(10), "Controller did not release the first transaction"

    def worker(role, operation, pid_queue):
        def run():
            with factory.begin() as db:
                conn = db.connection()
                conn.info["protocol_test_role"] = role
                try:
                    db.execute(text("SET LOCAL lock_timeout = '8s'"))
                    db.execute(text("SET LOCAL statement_timeout = '10s'"))
                    pid_queue.put(db.scalar(text("SELECT pg_backend_pid()")))
                    return operation(db)
                finally:
                    conn.info.pop("protocol_test_role", None)

        try:
            return "ok", _run_with_request_id(run)
        except AppError as exc:
            return "error", exc.code

    event.listen(engine, "after_cursor_execute", pause_after_lock)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            one = pool.submit(worker, "first", first, first_pid)
            try:
                assert held.wait(5), "First operation did not acquire the expected lock"
                holder = first_pid.get(timeout=2)
                two = pool.submit(worker, "second", second, second_pid)
                waiter = second_pid.get(timeout=2)
                deadline = wall_time.monotonic() + 5
                with engine.connect() as observer:
                    while wall_time.monotonic() < deadline:
                        blockers = observer.scalar(
                            text("SELECT pg_blocking_pids(:pid)"), {"pid": waiter}
                        )
                        if holder in blockers:
                            break
                        assert not two.done(), "Competing write bypassed serialization"
                        wall_time.sleep(0.01)
                    else:
                        pytest.fail("Competing transaction never waited on the holder")
            finally:
                release.set()
            return one.result(timeout=12), two.result(timeout=12)
    finally:
        event.remove(engine, "after_cursor_execute", pause_after_lock)


def _book(case, patient_index=0, target_date=TARGET_DATE, session_id=None):
    request = _create_request(case, case.patient_ids[patient_index], time(10))
    request.appointment_date = target_date
    request.session_definition_id = session_id or case.session_definition_id
    return lambda db: AppointmentService(db, FrozenClock(), _context(case)).create(
        request, idempotency_key=str(uuid4())
    )


def _block(case, mode):
    def run(db):
        service = SchedulingService(db, FrozenClock(), _context(case))
        if mode == "legacy":
            return service.block(
                BlockSessionRequest(
                    session_definition_id=case.session_definition_id,
                    date=TARGET_DATE,
                    reason="Away",
                )
            )
        return service.block_exception(
            case.doctor_id,
            BlockScheduleExceptionRequest(
                date=TARGET_DATE,
                scope=mode,
                reason="Away",
                session_definition_id=case.session_definition_id if mode == "SESSION" else None,
            ),
        )

    return run


def _unblock(case, bulk=False):
    def run(db):
        service = SchedulingService(db, FrozenClock(), _context(case))
        if bulk:
            return service.unblock_exceptions(
                case.doctor_id, UnblockScheduleExceptionRequest(occurrence_ids=[case.occurrence_id])
            )
        return service.unblock(case.occurrence_id)

    return run


@pytest.mark.parametrize("bulk", [False, True])
def test_booking_vs_unblock_has_no_occurrence_advisory_cycle(case_db, bulk):
    factory, engine, case = case_db
    _transaction(factory, _block(case, "legacy"))
    booking, unblock = _controlled_race(
        factory,
        engine,
        _doctor_date_lock_key(case.doctor_id, TARGET_DATE),
        _book(case),
        _unblock(case, bulk),
    )
    assert booking == ("error", "SESSION_BLOCKED")
    assert unblock[0] == "ok"
    # The failed booking rolled back, and the now-unblocked session accepts one booking.
    _transaction(factory, _book(case))
    with factory() as db:
        assert db.get(SessionOccurrence, case.occurrence_id).status == "AVAILABLE"
        assert (
            db.scalar(
                select(func.count(Appointment.appointment_id)).where(
                    Appointment.clinic_id == case.clinic_id
                )
            )
            == 1
        )


@pytest.mark.parametrize("mode", ["legacy", "SESSION", "FULL_DAY"])
@pytest.mark.parametrize("booking_first", [True, False])
@pytest.mark.parametrize("prematerialized", [True, False])
def test_block_and_booking_share_date_order_and_preserve_appointments(
    case_db, mode, booking_first, prematerialized
):
    factory, engine, case = case_db
    if not prematerialized:
        with factory.begin() as db:
            db.delete(db.get(SessionOccurrence, case.occurrence_id))
    first, second = (
        (_book(case), _block(case, mode)) if booking_first else (_block(case, mode), _book(case))
    )
    results = _controlled_race(
        factory, engine, _doctor_date_lock_key(case.doctor_id, TARGET_DATE), first, second
    )
    assert results[0][0] == "ok"
    if booking_first:
        assert results[1][0] == "ok"
    else:
        assert results[1] == ("error", "SESSION_BLOCKED")
    with factory() as db:
        occurrence = db.scalar(
            select(SessionOccurrence).where(
                SessionOccurrence.session_definition_id == case.session_definition_id,
                SessionOccurrence.occurrence_date == TARGET_DATE,
            )
        )
        assert occurrence.status == "BLOCKED"
        appointments = db.scalars(
            select(Appointment).where(Appointment.clinic_id == case.clinic_id)
        ).all()
        assert len(appointments) == int(booking_first)
        if appointments:
            assert appointments[0].status == "BOOKED"
            assert appointments[0].session_occurrence_id == occurrence.session_occurrence_id


def test_unblock_and_full_day_block_use_compatible_order(case_db):
    factory, engine, case = case_db
    _transaction(factory, _block(case, "legacy"))
    first, second = _controlled_race(
        factory,
        engine,
        _doctor_date_lock_key(case.doctor_id, TARGET_DATE),
        _unblock(case),
        _block(case, "FULL_DAY"),
    )
    assert first[0] == second[0] == "ok"
    with factory() as db:
        assert db.get(SessionOccurrence, case.occurrence_id).status == "BLOCKED"


def test_create_vs_reschedule_same_patient_has_no_patient_advisory_cycle(case_db):
    factory, engine, case = case_db
    original = _transaction(factory, _book(case))
    target = TARGET_DATE + timedelta(days=7)
    request = AppointmentRescheduleRequest(
        new_session_definition_id=case.session_definition_id,
        new_appointment_date=target,
        new_appointment_time=time(10),
    )

    def reschedule(db):
        return AppointmentService(db, FrozenClock(), _context(case)).reschedule(
            original.appointment_id, request, idempotency_key="move"
        )

    moved, created = _controlled_race(
        factory,
        engine,
        _doctor_date_lock_key(case.doctor_id, target),
        reschedule,
        _book(case, target_date=target),
    )
    assert moved[0] == "ok"
    assert created == ("error", "APPOINTMENT_DUPLICATE_ACTIVE")
    with factory() as db:
        old = db.get(Appointment, original.appointment_id)
        assert old.status == "CANCELLED"
        assert old.cancellation_reason == "RESCHEDULED"
        active = db.scalars(
            select(Appointment).where(
                Appointment.clinic_id == case.clinic_id, Appointment.status != "CANCELLED"
            )
        ).all()
        assert len(active) == 1
        assert active[0].appointment_id == old.rescheduled_to_appointment_id


@pytest.mark.parametrize("walk_in_first", [True, False])
def test_walk_in_serializes_with_full_day_block(case_db, walk_in_first):
    factory, engine, case = case_db

    def walk_in(db):
        return VisitService(db, FrozenClock(), _context(case)).walk_in(
            WalkInRequest(
                patient_id=case.patient_ids[0],
                doctor_id=case.doctor_id,
                session_definition_id=case.session_definition_id,
                appointment_type="REGULAR",
            ),
            idempotency_key="walk-in",
        )

    first, second = (
        (walk_in, _block(case, "FULL_DAY"))
        if walk_in_first
        else (_block(case, "FULL_DAY"), walk_in)
    )
    results = _controlled_race(
        factory, engine, _doctor_date_lock_key(case.doctor_id, TARGET_DATE), first, second
    )
    assert results[0][0] == "ok"
    if walk_in_first:
        assert results[1][0] == "ok"
    else:
        assert results[1] == ("error", "SESSION_BLOCKED")
    with factory() as db:
        appointments = db.scalars(
            select(Appointment).where(Appointment.clinic_id == case.clinic_id)
        ).all()
        assert len(appointments) == int(walk_in_first)
        if appointments:
            assert appointments[0].status == "CHECKED_IN"
            assert appointments[0].appointment_time is None
        assert db.get(SessionOccurrence, case.occurrence_id).status == "BLOCKED"


def test_reversed_bulk_unblocks_deduplicate_and_lock_all_dates_in_order(case_db):
    factory, engine, case = case_db
    later = TARGET_DATE + timedelta(days=7)
    _transaction(factory, _block(case, "legacy"))
    late_occurrence = _transaction(
        factory,
        lambda db: SchedulingService(db, FrozenClock(), _context(case)).block(
            BlockSessionRequest(
                session_definition_id=case.session_definition_id, date=later, reason="Away"
            )
        ),
    )
    early_id, late_id = case.occurrence_id, late_occurrence.session_occurrence_id

    def unblock(ids):
        return lambda db: SchedulingService(db, FrozenClock(), _context(case)).unblock_exceptions(
            case.doctor_id, UnblockScheduleExceptionRequest(occurrence_ids=ids)
        )

    first, second = _controlled_race(
        factory,
        engine,
        _doctor_date_lock_key(case.doctor_id, TARGET_DATE),
        unblock([early_id, late_id, early_id]),
        unblock([late_id, early_id]),
    )
    assert first[0] == second[0] == "ok"
    assert first[1].unblocked_count == 2
    assert second[1].unblocked_count == 0
    with factory() as db:
        assert all(
            db.get(SessionOccurrence, oid).status == "AVAILABLE" for oid in [early_id, late_id]
        )


def _future_plan(factory, case, target):
    with factory.begin() as db:
        current = db.scalar(
            select(ScheduleDefinition).where(ScheduleDefinition.doctor_id == case.doctor_id)
        )
        current.effective_to = target - timedelta(days=1)
        planned = ScheduleDefinition(
            clinic_id=case.clinic_id,
            doctor_id=case.doctor_id,
            weekday=0,
            effective_from=target,
            active=True,
            version=2,
            created_by=case.user_id,
        )
        db.add(planned)
        db.flush()
        session = SessionDefinition(
            clinic_id=case.clinic_id,
            schedule_definition_id=planned.schedule_definition_id,
            session_name="Planned",
            start_time=time(10),
            end_time=time(11),
            slot_interval_minutes=30,
            maximum_capacity=2,
            active=True,
            display_order=0,
        )
        db.add(session)
        db.flush()
        return session.session_definition_id


def _preview(factory, case):
    request = SchedulePreviewImpactRequest(
        weekdays=[0],
        sessions=[
            SessionWrite(
                session_name="Changed",
                start_time=time(10, 30),
                end_time=time(11, 30),
                slot_interval_minutes=30,
                maximum_capacity=2,
            )
        ],
    )
    response = _transaction(
        factory,
        lambda db: SchedulingService(db, FrozenClock(), _context(case)).preview_schedule_impact(
            case.doctor_id, request
        ),
    )
    return SmartScheduleApplyRequest(
        proposal_token=response.proposal_token, weekdays=[0], sessions=request.sessions
    )


def _seed_followup(factory, case, target):
    def seed(db):
        appointment = _book(case)(db)
        visits = VisitService(db, FrozenClock(), _context(case))
        checkin = visits.check_in(appointment.appointment_id, idempotency_key="check-in")
        completed = visits.complete(
            checkin.visit.visit_id,
            VisitCompleteRequest(follow_up=FollowUpCreateInput(due_date=target)),
            idempotency_key="complete",
        )
        return completed.followup.followup_id

    return _transaction(factory, seed)


@pytest.mark.parametrize("days_ahead", [7, 56])
@pytest.mark.parametrize("booking_kind", ["normal", "followup"])
@pytest.mark.parametrize("apply_first", [False, True])
def test_bookings_serialize_with_smart_apply_including_beyond_horizon(
    case_db, days_ahead, booking_kind, apply_first
):
    factory, engine, case = case_db
    target = TARGET_DATE + timedelta(days=days_ahead)
    # A newly booked far-future date is not in smart-apply's initial 30-day lock list.
    session_id = (
        _future_plan(factory, case, target) if days_ahead == 7 else case.session_definition_id
    )
    if booking_kind == "followup":
        followup_id = _seed_followup(factory, case, target)

        def book(db):
            return FollowUpService(db, FrozenClock(), _context(case)).book(
                followup_id,
                FollowUpBookRequest(
                    session_definition_id=session_id,
                    appointment_date=target,
                    appointment_time=time(10),
                ),
                idempotency_key="followup",
            )
    else:
        book = _book(case, target_date=target, session_id=session_id)
    request = _preview(factory, case)

    def apply(db):
        return SchedulingService(db, FrozenClock(), _context(case)).smart_apply_schedule(
            case.doctor_id, request
        )

    if apply_first:
        applied, booked = _controlled_race(
            factory, engine, _doctor_date_lock_key(case.doctor_id, TARGET_DATE), apply, book
        )
        assert applied[0] == "ok"
        error = "INVALID_APPOINTMENT_TIME" if days_ahead == 7 else "SESSION_NOT_VALID_FOR_DATE"
        assert booked == ("error", error)
    else:
        booked, applied = _controlled_race(
            factory, engine, _doctor_date_lock_key(case.doctor_id, target), book, apply
        )
        assert booked[0] == "ok"
        assert applied == ("error", "STALE_SCHEDULE_PREVIEW")
    with factory() as db:
        if not apply_first:
            assert db.get(SessionDefinition, session_id).start_time == time(10)
        if booking_kind == "followup":
            followup = db.get(FollowUpRecommendation, followup_id)
            assert followup.status == ("OPEN" if apply_first else "BOOKED")
            assert followup.linked_appointment_id == (
                None if apply_first else booked[1].appointment.appointment_id
            )


@pytest.mark.parametrize("override_first", [True, False])
def test_authorized_override_uses_locks_and_respects_blocks(case_db, override_first):
    factory, engine, case = case_db
    _transaction(factory, _book(case))
    context = replace(
        _context(case), permissions=_context(case).permissions | {"appointment.capacity_override"}
    )
    request = _create_request(case, case.patient_ids[1], time(10))
    request.capacity_override = CapacityOverrideInput(reason="Urgent extra patient")

    def override(db):
        return AppointmentService(db, FrozenClock(), context).create(
            request, idempotency_key="override"
        )

    first, second = (
        (override, _block(case, "FULL_DAY"))
        if override_first
        else (_block(case, "FULL_DAY"), override)
    )
    results = _controlled_race(
        factory, engine, _doctor_date_lock_key(case.doctor_id, TARGET_DATE), first, second
    )
    assert results[0][0] == "ok"
    if override_first:
        assert results[1][0] == "ok"
        with factory() as db:
            extra = db.get(Appointment, results[0][1].appointment_id)
            assert extra.capacity_override_used is True
            assert extra.override_existing_count == 1
    else:
        assert results[1] == ("error", "SESSION_BLOCKED")
    with factory() as db:
        assert db.get(SessionOccurrence, case.occurrence_id).status == "BLOCKED"
        assert db.scalar(
            select(func.count(Appointment.appointment_id)).where(
                Appointment.clinic_id == case.clinic_id
            )
        ) == 1 + int(override_first)


def test_cancellation_serializes_capacity_release_with_smart_apply(case_db):
    factory, engine, case = case_db
    appointment = _transaction(factory, _book(case))
    request = _preview(factory, case)

    def cancel(db):
        return AppointmentService(db, FrozenClock(), _context(case)).cancel(
            appointment.appointment_id, AppointmentCancelRequest(reason="PATIENT_CANCELLED")
        )

    def apply(db):
        return SchedulingService(db, FrozenClock(), _context(case)).smart_apply_schedule(
            case.doctor_id, request
        )

    cancelled, applied = _controlled_race(
        factory, engine, _doctor_date_lock_key(case.doctor_id, TARGET_DATE), cancel, apply
    )
    assert cancelled[0] == "ok"
    assert applied == ("error", "STALE_SCHEDULE_PREVIEW")
    with factory() as db:
        assert db.get(Appointment, appointment.appointment_id).status == "CANCELLED"


def test_concurrent_followup_bookings_recheck_state_after_patient_wait(case_db):
    factory, engine, case = case_db
    first_date = TARGET_DATE + timedelta(days=7)
    followup_id = _seed_followup(factory, case, first_date)

    def book(target):
        return lambda db: FollowUpService(db, FrozenClock(), _context(case)).book(
            followup_id,
            FollowUpBookRequest(
                session_definition_id=case.session_definition_id,
                appointment_date=target,
                appointment_time=time(10),
            ),
            idempotency_key=str(uuid4()),
        )

    first, second = _controlled_race(
        factory,
        engine,
        None,
        book(first_date),
        book(first_date + timedelta(days=7)),
        pause_on_patient=True,
    )
    assert first[0] == "ok"
    assert second == ("error", "FOLLOWUP_INVALID_STATE")
    with factory() as db:
        followup = db.get(FollowUpRecommendation, followup_id)
        assert followup.status == "BOOKED"
        assert followup.linked_appointment_id == first[1].appointment.appointment_id
        assert (
            db.scalar(
                select(func.count(Appointment.appointment_id)).where(
                    Appointment.clinic_id == case.clinic_id,
                    Appointment.appointment_type == "FOLLOW_UP",
                )
            )
            == 1
        )
