"""Persisted CF-05/CF-10 lifecycle and stored-state freshness regressions."""

import os
from dataclasses import replace
from datetime import time, timedelta

import jwt
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.appointments.schemas import AppointmentCancelRequest
from app.modules.appointments.service import AppointmentService
from app.modules.audit.models import AuditEvent
from app.modules.scheduling.lifecycle import load_weekday_timeline
from app.modules.scheduling.models import ScheduleDefinition, SessionDefinition, SessionOccurrence
from app.modules.scheduling.schemas import SchedulePreviewImpactRequest, SmartScheduleApplyRequest
from app.modules.scheduling.service import SchedulingService
from tests.integration.test_effective_occupancy import Scenario, window
from tests.integration.test_transaction_concurrency import TARGET_DATE, _session_factory

pytestmark = pytest.mark.skipif(
    os.getenv("CLINICFLOW_RUN_INTEGRATION") != "1", reason="Requires migrated PostgreSQL."
)

PLAN_DATE = TARGET_DATE + timedelta(days=7)


@pytest.fixture
def scenario():
    factory, engine = _session_factory()
    try:
        value = Scenario(factory)
        value.apply([window()])
        value.apply([window()])
        yield value
    finally:
        engine.dispose()


def timeline(s):
    return s.run(
        lambda db: load_weekday_timeline(
            db, s.case.clinic_id, s.case.doctor_id, 0, s.clock.clinic_date()
        )
    )


def snapshot(s):
    def read(db):
        tables = (ScheduleDefinition, SessionDefinition, SessionOccurrence, Appointment, AuditEvent)
        return {
            model.__tablename__: [
                {column.key: getattr(row, column.key) for column in model.__mapper__.column_attrs}
                for row in db.scalars(
                    select(model)
                    .where(model.clinic_id == s.case.clinic_id)
                    .order_by(*model.__table__.primary_key.columns)
                ).all()
            ]
            for model in tables
        }

    return s.run(read)


def apply_token(s, preview, windows, weekdays=None):
    return s.run(
        lambda db: SchedulingService(db, s.clock, s.context).smart_apply_schedule(
            s.case.doctor_id,
            SmartScheduleApplyRequest(
                proposal_token=preview.proposal_token,
                weekdays=weekdays or [0],
                sessions=windows,
            ),
        )
    )


def assert_same_plan(before, after, *, working):
    assert after.planned.schedule_definition_id == before.planned.schedule_definition_id
    assert after.planned.version == before.planned.version
    assert after.planned.active is working
    assert after.predecessor.effective_to == after.planned.effective_from - timedelta(days=1)
    assert after.predecessor.schedule_definition_id == before.predecessor.schedule_definition_id


@pytest.mark.parametrize(
    ("before_working", "after_working"),
    [
        (True, True),
        (True, False),
        (False, True),
        (False, False),
    ],
)
def test_future_working_off_transitions_keep_one_discoverable_business_version(
    scenario,
    before_working,
    after_working,
):
    s = scenario
    if not before_working:
        s.apply([])
    before = timeline(s)
    old_definitions = snapshot(s)["schedule_definitions"]
    proposal = [window(start=time(9), end=time(13), capacity=3)] if after_working else []
    s.apply(proposal)
    after = timeline(s)
    assert_same_plan(before, after, working=after_working)
    assert after.planned.effective_from == PLAN_DATE
    assert len(snapshot(s)["schedule_definitions"]) == len(old_definitions)
    sessions = after.sessions[after.planned.schedule_definition_id]
    assert len(sessions) == (1 if after_working else 0)
    if after_working:
        assert sessions[0].start_time == time(9)
        assert sessions[0].end_time == time(13)
        assert sessions[0].maximum_capacity == 3
        if before_working:
            assert (
                sessions[0].session_definition_id
                == before.sessions[before.planned.schedule_definition_id][0].session_definition_id
            )
    overview = s.run(
        lambda db: SchedulingService(db, s.clock, s.context).schedule_overview(s.case.doctor_id)
    )
    assert overview.days[0].upcoming.schedule_definition_id == after.planned.schedule_definition_id
    assert overview.days[0].upcoming.active is after_working


def test_all_inactive_sessions_are_a_discoverable_day_off_plan(scenario):
    s = scenario
    proposal = window()
    proposal.active = False
    before = timeline(s)
    s.apply([proposal])
    after = timeline(s)
    assert_same_plan(before, after, working=False)
    assert not after.working_sessions(after.planned)
    assert not s.availability(PLAN_DATE).sessions
    s.apply([window()])
    assert_same_plan(before, timeline(s), working=True)


def test_repeated_later_retargeting_preserves_version_anchors_and_contiguous_predecessor(scenario):
    s = scenario
    before = timeline(s)
    original = s.book(target=PLAN_DATE + timedelta(days=7))
    anchor = s.snapshot(original.appointment_id)
    result = s.apply([window(start=time(11))])
    assert result.impacts[0].applies_from == PLAN_DATE + timedelta(days=14)
    after = timeline(s)
    assert_same_plan(before, after, working=True)
    assert after.predecessor.effective_to == PLAN_DATE + timedelta(days=13)
    assert s.snapshot(original.appointment_id) == anchor
    assert s.availability(PLAN_DATE + timedelta(days=7)).sessions[0].used_capacity == 1

    later = s.book(time(11), target=PLAN_DATE + timedelta(days=21), patient=s.case.patient_ids[1])
    later_anchor = s.snapshot(later.appointment_id)
    second = s.apply([window(end=time(11))])
    assert second.impacts[0].applies_from == PLAN_DATE + timedelta(days=28)
    assert_same_plan(before, timeline(s), working=True)
    assert timeline(s).predecessor.effective_to == PLAN_DATE + timedelta(days=27)
    assert s.snapshot(original.appointment_id) == anchor
    assert s.snapshot(later.appointment_id) == later_anchor
    future = [d for d in snapshot(s)["schedule_definitions"] if d["effective_from"] > TARGET_DATE]
    assert len(future) == 1


def test_plan_never_moves_earlier_when_a_previously_deferred_conflict_disappears(scenario):
    s = scenario
    original = s.book(target=PLAN_DATE)
    s.apply([window(start=time(11))])
    date_after_move = timeline(s).planned.effective_from
    # Cancellation changes live occupancy, not the planned start-date floor.
    s.run(lambda db: setattr(db.get(Appointment, original.appointment_id), "status", "CANCELLED"))
    s.apply([window()])
    assert timeline(s).planned.effective_from == date_after_move


def test_retarget_rejects_incompatible_restored_predecessor_without_any_writes(scenario):
    s = scenario
    s.apply([window(start=time(11), end=time(14))])
    s.book(time(13), target=PLAN_DATE)
    before = snapshot(s)
    with pytest.raises(AppError) as error:
        s.preview([window(start=time(11), end=time(13))])
    assert error.value.code == "UNRESOLVABLE_APPOINTMENT_CONFLICT"
    assert snapshot(s) == before  # The predecessor ends at noon; 13:00 cannot be restored into it.


@pytest.mark.parametrize("successor_working", [True, False])
def test_independent_successor_bounds_scan_and_retargeting(scenario, successor_working):
    s = scenario
    initial = timeline(s)
    successor_start = PLAN_DATE + timedelta(days=21)

    def seed(db):
        plan = db.get(ScheduleDefinition, initial.planned.schedule_definition_id)
        plan.effective_to = successor_start - timedelta(days=1)
        db.flush()
        successor = ScheduleDefinition(
            clinic_id=s.case.clinic_id,
            doctor_id=s.case.doctor_id,
            weekday=0,
            effective_from=successor_start,
            active=successor_working,
            version=plan.version + 1,
            created_by=s.case.user_id,
        )
        db.add(successor)
        db.flush()
        session = SessionDefinition(
            clinic_id=s.case.clinic_id,
            schedule_definition_id=successor.schedule_definition_id,
            session_name="Independent",
            start_time=time(9),
            end_time=time(10),
            maximum_capacity=2,
            slot_interval_minutes=30,
            active=True,
            display_order=0,
        )
        db.add(session)
        db.flush()
        return session.session_definition_id

    successor_session = s.run(seed)
    planned_session = s.session_id
    s.session_id = successor_session
    if successor_working:
        s.book(time(9), target=successor_start)
    s.session_id = planned_session
    old_successor = timeline(s).successor
    preview = s.apply([window(start=time(11))])
    assert preview.impacts[0].applies_from == PLAN_DATE
    assert not preview.impacts[0].conflict_detected  # Successor's 09:00 booking is outside scope.
    assert timeline(s).successor.effective_from == old_successor.effective_from
    assert timeline(s).planned.effective_to == successor_start - timedelta(days=1)

    # The independent successor's content cannot affect the earlier plan's period.
    proposal = [window(start=time(11))]
    token = s.preview(proposal)
    digest = timeline(s).fingerprint()

    def edit_independent_content(db):
        session = db.get(SessionDefinition, successor_session)
        session.session_name = "Independent edited"
        session.end_time = time(11)
        parent = db.get(ScheduleDefinition, session.schedule_definition_id)
        parent.active = not parent.active

    s.run(edit_independent_content)
    assert timeline(s).fingerprint() == digest
    apply_token(s, token, proposal)

    s.book(time(11), target=successor_start - timedelta(days=7), patient=s.case.patient_ids[1])
    before = snapshot(s)
    with pytest.raises(AppError) as error:
        s.preview([window(end=time(11))])
    assert error.value.code == "UNRESOLVABLE_APPOINTMENT_CONFLICT"
    assert snapshot(s) == before


def test_plan_start_between_weekdays_still_protects_matching_recurrences(scenario):
    s = scenario
    initial = timeline(s)
    earlier_start = PLAN_DATE - timedelta(days=4)  # Thursday, with a Monday definition.

    def seed_legacy_boundary(db):
        predecessor = db.get(ScheduleDefinition, initial.predecessor.schedule_definition_id)
        predecessor.effective_to = earlier_start - timedelta(days=1)
        db.flush()
        db.get(
            ScheduleDefinition, initial.planned.schedule_definition_id
        ).effective_from = earlier_start

    s.run(seed_legacy_boundary)
    retained = s.book(target=PLAN_DATE)
    before = s.snapshot(retained.appointment_id)
    preview = s.apply([window(start=time(11))])
    assert preview.impacts[0].applies_from == earlier_start + timedelta(days=7)
    assert s.snapshot(retained.appointment_id) == before
    assert_same_plan(initial, timeline(s), working=True)


def test_late_booking_tail_extends_default_horizon_and_retains_original_anchor(scenario):
    s = scenario
    target = TARGET_DATE + timedelta(days=56)
    retained = s.book(target=target)
    before = s.snapshot(retained.appointment_id)
    plan_before = timeline(s)
    preview = s.apply([window(start=time(11))])
    assert preview.impacts[0].applies_from == target + timedelta(days=7)
    assert_same_plan(plan_before, timeline(s), working=True)
    assert s.snapshot(retained.appointment_id) == before
    assert s.availability(target).sessions[0].used_capacity == 1


def test_plan_beyond_shrunken_horizon_remains_editable_without_new_version(scenario):
    s = scenario
    original = timeline(s)
    booking = s.book(target=TARGET_DATE + timedelta(days=49))
    s.apply([window(start=time(11))])
    deferred = timeline(s)
    assert_same_plan(original, deferred, working=True)
    assert deferred.planned.effective_from == TARGET_DATE + timedelta(days=56)

    cancelled = s.run(
        lambda db: AppointmentService(db, s.clock, s.context).cancel(
            booking.appointment_id, AppointmentCancelRequest(reason="PATIENT_CANCELLED")
        )
    )
    assert cancelled.status == "CANCELLED"
    horizon = s.run(
        lambda db: SchedulingService(db, s.clock, s.context)._protection_horizon(s.case.doctor_id)
    )
    assert horizon == TARGET_DATE + timedelta(days=30)
    assert deferred.planned.effective_from > horizon
    before = snapshot(s)

    proposal = [window(start=time(11), end=time(13), capacity=3)]
    preview = s.preview(proposal)
    assert preview.impacts[0].applies_from == deferred.planned.effective_from
    assert not preview.impacts[0].conflict_detected
    apply_token(s, preview, proposal)

    after = timeline(s)
    assert_same_plan(deferred, after, working=True)
    assert after.planned.effective_from == deferred.planned.effective_from
    assert after.predecessor.effective_to == deferred.predecessor.effective_to
    assert snapshot(s)["schedule_definitions"] == before["schedule_definitions"]
    assert snapshot(s)["appointments"] == before["appointments"]
    sessions = after.working_sessions(after.planned)
    assert len(sessions) == 1
    assert sessions[0].end_time == time(13)
    assert sessions[0].maximum_capacity == 3


def test_live_booking_after_preview_still_requires_authoritative_revalidation(scenario):
    s = scenario
    proposal = [window(start=time(11))]
    preview = s.preview(proposal)
    fingerprint = timeline(s).fingerprint()
    s.book(target=PLAN_DATE + timedelta(days=7))
    assert timeline(s).fingerprint() == fingerprint  # Appointments are deliberately not hashed.
    before = snapshot(s)
    with pytest.raises(AppError) as error:
        apply_token(s, preview, proposal)
    assert error.value.code == "STALE_SCHEDULE_PREVIEW"
    assert snapshot(s) == before


def test_newly_effective_day_off_is_immutable_and_second_edit_defers(scenario):
    s = scenario
    s.apply([])
    old_plan = timeline(s).planned
    # Advance the authoritative clock to activation day, before clinic hours.
    from tests.integration.test_schedule_redesign_api import MockClock

    s.clock = MockClock(s.clock.instant + timedelta(days=7), PLAN_DATE)
    before = snapshot(s)
    preview = s.apply([window()])
    assert preview.impacts[0].applies_from == PLAN_DATE + timedelta(days=7)
    after = timeline(s)
    assert after.current.schedule_definition_id == old_plan.schedule_definition_id
    assert after.current.active is False
    assert after.planned.version == old_plan.version + 1
    assert after.planned.schedule_definition_id != old_plan.schedule_definition_id
    old_sessions = [
        row
        for row in before["session_definitions"]
        if row["schedule_definition_id"] == old_plan.schedule_definition_id
    ]
    new_sessions = [
        row
        for row in snapshot(s)["session_definitions"]
        if row["schedule_definition_id"] == old_plan.schedule_definition_id
    ]
    assert new_sessions == old_sessions


def test_inactive_predecessor_cannot_silently_absorb_a_displaced_booking(scenario):
    s = scenario
    predecessor_id = timeline(s).predecessor.schedule_definition_id
    s.run(lambda db: setattr(db.get(ScheduleDefinition, predecessor_id), "active", False))
    s.book(target=PLAN_DATE)
    before = snapshot(s)
    with pytest.raises(AppError) as error:
        s.preview([window(start=time(11))])
    assert error.value.code == "UNRESOLVABLE_APPOINTMENT_CONFLICT"
    assert snapshot(s) == before


def test_displaced_planned_block_cannot_be_lost_by_retargeting(scenario):
    s = scenario
    from app.modules.scheduling.schemas import BlockSessionRequest

    s.run(
        lambda db: SchedulingService(db, s.clock, s.context).block(
            BlockSessionRequest(
                session_definition_id=s.session_id,
                date=PLAN_DATE,
                reason="Doctor away",
            )
        )
    )
    before = snapshot(s)
    with pytest.raises(AppError) as error:
        s.preview([window(start=time(11))])
    assert error.value.code == "UNRESOLVABLE_APPOINTMENT_CONFLICT"
    assert snapshot(s) == before


def test_existing_inactive_overlap_is_rejected_without_partial_timeline_repair(scenario):
    s = scenario
    s.apply([])
    predecessor = timeline(s).predecessor
    # Legacy malformed data is not protected by the DB's active-only exclusion.
    s.run(
        lambda db: setattr(
            db.get(ScheduleDefinition, predecessor.schedule_definition_id), "effective_to", None
        )
    )
    before = snapshot(s)
    with pytest.raises(AppError) as error:
        s.preview([])
    assert error.value.code == "UNRESOLVABLE_APPOINTMENT_CONFLICT"
    assert snapshot(s) == before


@pytest.mark.parametrize(
    "change",
    [
        "working",
        "off",
        "on",
        "retarget",
        "time",
        "interval",
        "capacity",
        "add",
        "remove",
        "deactivate",
        "name",
        "order",
    ],
)
def test_same_id_and_business_version_content_changes_invalidate_old_preview(scenario, change):
    s = scenario
    if change == "on":
        s.apply([])
    if change == "remove":
        s.apply([window(), window(start=time(14), end=time(16), order=1)])
    proposal_a = [window(start=time(9), end=time(13))]
    token_a = s.preview(proposal_a)
    initial = timeline(s)
    modified = window()
    proposal_b = [modified]
    if change == "working":
        modified.start_time = time(9)
    elif change == "off":
        proposal_b = []
    elif change == "retarget":
        s.book(target=PLAN_DATE + timedelta(days=7))
        modified.start_time = time(11)
    elif change == "time":
        modified.end_time = time(13)
    elif change == "interval":
        modified.slot_interval_minutes = 15
    elif change == "capacity":
        modified.maximum_capacity = 3
    elif change == "add":
        proposal_b.append(window(start=time(14), end=time(16), order=1))
    elif change == "deactivate":
        modified.active = False
    elif change == "name":
        modified.session_name = "Renamed"
    elif change == "order":
        modified.display_order = 3
    s.apply(proposal_b)
    changed = timeline(s)
    assert changed.planned.schedule_definition_id == initial.planned.schedule_definition_id
    assert changed.planned.version == initial.planned.version
    assert changed.fingerprint() != initial.fingerprint()
    before_stale_apply = snapshot(s)
    with pytest.raises(AppError) as error:
        apply_token(s, token_a, proposal_a)
    assert error.value.code == "STALE_SCHEDULE_PREVIEW"
    assert snapshot(s) == before_stale_apply


@pytest.mark.parametrize("weekday", [1, 4])
def test_unrelated_weekday_change_does_not_invalidate_preview(scenario, weekday):
    s = scenario
    proposal = [window(start=time(9))]
    token = s.preview(proposal)
    fingerprint = timeline(s).fingerprint()
    other_preview = s.run(
        lambda db: SchedulingService(db, s.clock, s.context).preview_schedule_impact(
            s.case.doctor_id, SchedulePreviewImpactRequest(weekdays=[weekday], sessions=[window()])
        )
    )
    apply_token(s, other_preview, [window()], [weekday])
    assert timeline(s).fingerprint() == fingerprint
    apply_token(s, token, proposal)
    assert timeline(s).working_sessions(timeline(s).planned)[0].start_time == time(9)


def test_fingerprint_canonical_ordering_and_explicit_absence(scenario):
    s = scenario
    s.apply([window(), window(start=time(14), end=time(16), order=1)])
    state = timeline(s)
    digest = state.fingerprint()
    state.sessions[state.planned.schedule_definition_id].reverse()
    assert state.fingerprint() == digest
    absent = s.run(
        lambda db: load_weekday_timeline(db, s.case.clinic_id, s.case.doctor_id, 1, TARGET_DATE)
    )
    assert absent.current is None and absent.planned is None
    assert absent.fingerprint() != digest


@pytest.mark.parametrize("mode", ["tampered", "expired", "old_format"])
def test_signed_preview_tampering_expiry_and_missing_fingerprint_rejected(scenario, mode):
    s = scenario
    proposal = [window()]
    preview = s.preview(proposal)
    if mode == "tampered":
        claims = jwt.decode(preview.proposal_token, options={"verify_signature": False})
        claims["expected_states"]["0"]["safe_date"] = "2026-12-01"
        preview.proposal_token = jwt.encode(
            claims, "wrong-signing-key-with-at-least-32-characters", algorithm="HS256"
        )
    elif mode == "expired":
        s.clock = replace(s.clock, instant=s.clock.instant + timedelta(minutes=11))
    else:
        from app.modules.scheduling.proposal_tokens import _proposal_token_secret

        claims = jwt.decode(preview.proposal_token, options={"verify_signature": False})
        del claims["expected_states"]["0"]["stored_state_fingerprint"]
        preview.proposal_token = jwt.encode(claims, _proposal_token_secret(), algorithm="HS256")
    before = snapshot(s)
    with pytest.raises(AppError) as error:
        apply_token(s, preview, proposal)
    assert error.value.code == "STALE_SCHEDULE_PREVIEW"
    assert snapshot(s) == before


def test_failure_after_plan_predecessor_and_sessions_mutate_rolls_everything_back(
    scenario, monkeypatch
):
    s = scenario
    s.book(target=PLAN_DATE)
    proposal = [window(start=time(11))]
    preview = s.preview(proposal)
    before = snapshot(s)
    initial = timeline(s)
    original_flush = Session.flush
    observed = []

    def fail_after_writes(db, *args, **kwargs):
        original_flush(db, *args, **kwargs)
        changed = [
            row
            for row in db.identity_map.values()
            if isinstance(row, SessionDefinition)
            and row.schedule_definition_id == initial.planned.schedule_definition_id
            and row.start_time == time(11)
        ]
        if changed:
            plan = db.get(ScheduleDefinition, initial.planned.schedule_definition_id)
            predecessor = db.get(ScheduleDefinition, initial.predecessor.schedule_definition_id)
            assert plan.effective_from == PLAN_DATE + timedelta(days=7)
            assert predecessor.effective_to == PLAN_DATE + timedelta(days=6)
            observed.append(True)
            raise RuntimeError("Injected after lifecycle and session writes")

    with monkeypatch.context() as scoped:
        scoped.setattr(Session, "flush", fail_after_writes)
        with pytest.raises(RuntimeError, match="Injected"):
            apply_token(s, preview, proposal)
    assert observed
    assert snapshot(s) == before
