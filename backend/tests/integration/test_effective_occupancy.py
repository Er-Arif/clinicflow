"""CF-02/CF-11 regressions through persisted bookings and the approved lifecycle."""

import os
from dataclasses import replace
from datetime import time, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.errors import AppError
from app.modules.appointments.availability import AppointmentAvailabilityService
from app.modules.appointments.models import Appointment
from app.modules.appointments.schemas import (
    AppointmentCancelRequest,
    AppointmentRescheduleRequest,
    CapacityOverrideInput,
)
from app.modules.appointments.service import AppointmentService
from app.modules.audit.models import AuditEvent
from app.modules.followups.models import FollowUpRecommendation
from app.modules.followups.schemas import (
    FollowUpBookRequest,
    FollowUpCreateInput,
    VisitCompleteRequest,
)
from app.modules.followups.service import FollowUpService
from app.modules.patients.models import Patient
from app.modules.scheduling.models import SessionDefinition, SessionOccurrence
from app.modules.scheduling.schemas import (
    SchedulePreviewImpactRequest,
    SessionWrite,
    SmartScheduleApplyRequest,
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
    os.getenv("CLINICFLOW_RUN_INTEGRATION") != "1", reason="Requires migrated PostgreSQL."
)


def window(start=time(10), end=time(12), capacity=2, order=0, interval=30):
    return SessionWrite(
        session_name=f"Session {order}",
        start_time=start,
        end_time=end,
        slot_interval_minutes=interval,
        maximum_capacity=capacity,
        display_order=order,
    )


class Scenario:
    def __init__(self, factory):
        self.factory = factory
        self.case = _seed_case(factory, capacity=2)
        self.context = _context(self.case)
        self.clock = FrozenClock()
        self.session_id = self.case.session_definition_id

    def run(self, operation):
        def transaction():
            with self.factory.begin() as db:
                return operation(db)

        return _run_with_request_id(transaction)

    def patient(self):
        def insert(db):
            source = db.get(Patient, self.case.patient_ids[0])
            values = {
                c.name: getattr(source, c.name)
                for c in Patient.__table__.columns
                if c.name not in {"patient_id", "patient_code", "created_at", "updated_at"}
            }
            patient = Patient(**values, patient_code=f"PT-{uuid4().hex[:12]}")
            db.add(patient)
            db.flush()
            return patient.patient_id

        return self.run(insert)

    def book(self, at=time(10), *, patient=None, override=False, target=TARGET_DATE):
        request = _create_request(self.case, patient or self.case.patient_ids[0], at)
        request.session_definition_id = self.session_id
        request.appointment_date = target
        if override:
            request.capacity_override = CapacityOverrideInput(reason="Urgent additional patient")
        return self.run(
            lambda db: AppointmentService(db, self.clock, self.context).create(
                request, idempotency_key=str(uuid4())
            )
        )

    def walk_in(self, patient=None):
        request = WalkInRequest(
            patient_id=patient or self.case.patient_ids[0],
            doctor_id=self.case.doctor_id,
            session_definition_id=self.session_id,
            appointment_type="REGULAR",
        )
        return self.run(
            lambda db: VisitService(db, self.clock, self.context).walk_in(
                request, idempotency_key=str(uuid4())
            )
        ).appointment

    def preview(self, windows):
        return self.run(
            lambda db: SchedulingService(db, self.clock, self.context).preview_schedule_impact(
                self.case.doctor_id, SchedulePreviewImpactRequest(weekdays=[0], sessions=windows)
            )
        )

    def apply(self, windows):
        preview = self.preview(windows)
        self.run(
            lambda db: SchedulingService(db, self.clock, self.context).smart_apply_schedule(
                self.case.doctor_id,
                SmartScheduleApplyRequest(
                    weekdays=[0],
                    sessions=windows,
                    proposal_token=preview.proposal_token,
                ),
            )
        )
        availability = self.availability(target=preview.impacts[0].applies_from)
        self.session_id = (
            availability.sessions[0].session_definition_id if availability.sessions else None
        )
        return preview

    def availability(self, target=TARGET_DATE, *, facade=True):
        if facade:
            return self.run(
                lambda db: AppointmentAvailabilityService(db, self.clock, self.context).get(
                    self.case.doctor_id, target
                )
            )
        return self.run(
            lambda db: SchedulingService(db, self.clock, self.context).availability(
                self.case.doctor_id, target
            )
        )

    def snapshot(self, appointment_id):
        def read(db):
            appointment = db.get(Appointment, appointment_id)
            occurrence = db.get(SessionOccurrence, appointment.session_occurrence_id)
            return tuple(
                {c.name: getattr(model, c.name) for c in model.__table__.columns}
                for model in (appointment, occurrence)
            )

        return self.run(read)


@pytest.fixture
def scenario():
    factory, engine = _session_factory()
    try:
        yield Scenario(factory)
    finally:
        engine.dispose()


@pytest.mark.parametrize("status", ["BOOKED", "CHECKED_IN", "COMPLETED"])
def test_retained_booking_occupies_new_window_without_changing_any_snapshot(scenario, status):
    s = scenario
    original = s.book()
    s.run(lambda db: setattr(db.get(Appointment, original.appointment_id), "status", status))
    before = s.snapshot(original.appointment_id)
    preview = s.apply([window(start=time(9, 30), capacity=3)])
    assert preview.impacts[0].applies_from == TARGET_DATE
    assert not preview.impacts[0].conflict_detected
    assert s.snapshot(original.appointment_id) == before
    assert s.session_id != s.case.session_definition_id
    effective = s.availability().sessions[0]
    assert not effective.materialized  # Occupancy must work even before a new occurrence exists.
    assert effective.used_capacity == 1
    assert effective.remaining_capacity == 2
    assert not next(slot for slot in effective.slots if slot.time == time(10)).available
    assert s.availability(facade=False) == s.availability()
    with pytest.raises(AppError, match="no longer available") as error:
        s.book(patient=s.case.patient_ids[1])
    assert error.value.code == "APPOINTMENT_SLOT_UNAVAILABLE"
    s.book(time(11), patient=s.case.patient_ids[1])
    assert s.availability().sessions[0].used_capacity == 2
    assert s.snapshot(original.appointment_id) == before


def test_session_capacity_is_shared_by_retained_and_current_timed_bookings(scenario):
    s = scenario
    s.book()
    s.apply([window()])
    s.book(time(10, 30), patient=s.case.patient_ids[1])
    available = s.availability().sessions[0]
    assert available.used_capacity == 2 and available.remaining_capacity == 0
    assert all(not slot.normal_booking_allowed for slot in available.slots)
    with pytest.raises(AppError) as error:
        s.book(time(11), patient=s.patient())
    assert error.value.code == "SESSION_FULL"


@pytest.mark.parametrize("walk_in_before_change", [True, False])
def test_retained_and_untimed_appointments_share_capacity_without_fake_times(
    scenario, walk_in_before_change
):
    s = scenario
    timed = s.book()
    if walk_in_before_change:
        walkin = s.walk_in(s.case.patient_ids[1])
        before = s.snapshot(walkin.appointment_id)
    s.apply([window(start=time(9, 30))])
    if not walk_in_before_change:
        walkin = s.walk_in(s.case.patient_ids[1])
        before = s.snapshot(walkin.appointment_id)
    available = s.availability().sessions[0]
    assert available.used_capacity == 2 and available.remaining_capacity == 0
    assert s.snapshot(walkin.appointment_id) == before
    assert before[0]["appointment_time"] is None
    assert s.snapshot(timed.appointment_id)[0]["session_occurrence_id"] == s.case.occurrence_id
    with pytest.raises(AppError) as error:
        s.book(time(11), patient=s.patient())
    assert error.value.code == "SESSION_FULL"
    with pytest.raises(AppError) as error:
        s.walk_in(s.patient())
    assert error.value.code == "SESSION_FULL"


def test_untimed_walk_in_reduces_capacity_but_leaves_every_timed_slot_free(scenario):
    s = scenario
    walkin = s.walk_in()
    s.apply([window()])
    available = s.availability().sessions[0]
    assert available.used_capacity == 1 and available.remaining_capacity == 1
    assert all(slot.available and slot.normal_booking_allowed for slot in available.slots)
    assert s.snapshot(walkin.appointment_id)[0]["appointment_time"] is None


@pytest.mark.parametrize("invalid_time", [time(10, 30), time(10, 50), time(11), time(10, 0, 1)])
def test_full_interval_slot_rule_matches_availability_and_direct_booking(scenario, invalid_time):
    s = scenario
    s.apply([window(end=time(10, 50), capacity=1)])
    assert [slot.time for slot in s.availability().sessions[0].slots] == [time(10)]
    with pytest.raises(AppError) as error:
        s.book(invalid_time)
    assert error.value.code == "INVALID_APPOINTMENT_TIME"
    valid = s.book(time(10))
    assert s.snapshot(valid.appointment_id)[0]["appointment_time"] == time(10)


@pytest.mark.parametrize(
    ("kind", "windows", "reason"),
    [
        ("timed", [window(start=time(11))], "outside proposed hours"),
        ("timed", [window(), window(start=time(10, 30), order=1)], "ambiguous"),
        ("timed", [window(end=time(10, 50), capacity=1)], "full 30-minute slot"),
        ("walkin", [window(capacity=1)], "exceed proposed capacity"),
        (
            "walkin",
            [
                window(end=time(10, 30), capacity=1),
                window(start=time(10, 30), end=time(11), capacity=1, order=1),
            ],
            "ambiguous",
        ),
        ("walkin", [window(start=time(11))], "no corresponding session"),
    ],
)
def test_preview_and_smart_apply_defer_incompatible_mapping_slots_and_capacity(
    scenario,
    kind,
    windows,
    reason,
):
    s = scenario
    if kind == "timed":
        appointment = s.book(time(10, 30))
    else:
        appointment = s.walk_in()
        if reason == "exceed proposed capacity":
            s.book(time(10), patient=s.case.patient_ids[1])
    before = s.snapshot(appointment.appointment_id)
    preview = s.apply(windows)
    impact = preview.impacts[0]
    assert impact.conflict_detected
    assert impact.applies_from == TARGET_DATE + timedelta(days=7)
    assert reason in impact.conflict_metadata["reason"]
    assert impact.existing_appointments_count == (2 if reason == "exceed proposed capacity" else 1)
    assert s.snapshot(appointment.appointment_id) == before
    # The unsafe date retains the previous effective definition, not the proposal.
    assert s.availability().sessions[0].session_definition_id == s.case.session_definition_id


def test_preview_includes_booking_retained_from_an_earlier_version(scenario):
    s = scenario
    target = TARGET_DATE + timedelta(days=7)
    original = s.book(time(10, 30), target=target)
    before = s.snapshot(original.appointment_id)
    s.apply([window()])
    # A second same-day edit starts next week; that retained booking must defer it again.
    preview = s.apply([window(start=time(11))])
    assert preview.impacts[0].conflict_detected
    assert preview.impacts[0].applies_from == TARGET_DATE + timedelta(days=14)
    assert s.snapshot(original.appointment_id) == before


def test_adjacent_boundary_maps_to_later_session_and_exact_fit_is_valid(scenario):
    s = scenario
    s.book(time(10, 30))
    s.apply(
        [
            window(end=time(10, 30), capacity=1),
            window(start=time(10, 30), end=time(11), capacity=1, order=1),
        ]
    )
    first, second = s.availability().sessions
    assert first.used_capacity == 0 and second.used_capacity == 1
    assert [slot.time for slot in first.slots] == [time(10)]
    assert [slot.time for slot in second.slots] == [time(10, 30)]
    assert not second.slots[0].available


def test_cancelled_retained_booking_does_not_consume_capacity_or_slot(scenario):
    s = scenario
    original = s.book()
    s.apply([window()])
    s.run(
        lambda db: AppointmentService(db, s.clock, s.context).cancel(
            original.appointment_id, AppointmentCancelRequest(reason="PATIENT_CANCELLED")
        )
    )
    available = s.availability().sessions[0]
    assert available.used_capacity == 0 and all(slot.available for slot in available.slots)
    s.book(patient=s.case.patient_ids[1])
    assert s.snapshot(original.appointment_id)[0]["session_occurrence_id"] == s.case.occurrence_id
    assert s.availability().sessions[0].used_capacity == 1


def test_rescheduling_retained_appointment_excludes_original_then_counts_replacement_once(scenario):
    s = scenario
    original = s.book()
    s.apply([window(capacity=1)])
    result = s.run(
        lambda db: AppointmentService(db, s.clock, s.context).reschedule(
            original.appointment_id,
            AppointmentRescheduleRequest(
                new_session_definition_id=s.session_id,
                new_appointment_date=TARGET_DATE,
                new_appointment_time=time(11),
            ),
            idempotency_key=str(uuid4()),
        )
    )
    persisted = s.snapshot(original.appointment_id)[0]
    assert persisted["status"] == "CANCELLED"
    assert persisted["cancellation_reason"] == "RESCHEDULED"
    assert persisted["session_occurrence_id"] == s.case.occurrence_id
    assert persisted["rescheduled_to_appointment_id"] == result.replacement.appointment_id
    assert s.availability().sessions[0].used_capacity == 1


@pytest.mark.parametrize("at", [time(10), time(11)])
def test_authorized_override_preserves_audit_count_and_counts_against_effective_capacity(
    scenario, at
):
    s = scenario
    s.book()
    s.apply([window(capacity=1)])
    s.context = replace(
        s.context, permissions=s.context.permissions | {"appointment.capacity_override"}
    )
    extra = s.book(at, patient=s.case.patient_ids[1], override=True)
    persisted = s.snapshot(extra.appointment_id)[0]
    assert persisted["capacity_override_used"]
    assert persisted["override_existing_count"] == 1
    assert persisted["override_capacity_snapshot"] == 1
    assert s.availability().sessions[0].used_capacity == 2
    assert s.availability().sessions[0].remaining_capacity == 0
    with pytest.raises(AppError) as error:
        s.book(time(11, 30), patient=s.patient())
    assert error.value.code == "SESSION_FULL"


@pytest.mark.parametrize(
    ("capacity", "at", "code"),
    [
        (1, time(10, 30), "SESSION_FULL"),
        (2, time(10), "APPOINTMENT_SLOT_UNAVAILABLE"),
    ],
)
def test_followup_booking_uses_retained_capacity_and_timed_occupancy(scenario, capacity, at, code):
    s = scenario
    target = TARGET_DATE + timedelta(days=7)
    source = s.book()
    checked_in = s.run(
        lambda db: VisitService(db, s.clock, s.context).check_in(
            source.appointment_id, idempotency_key=str(uuid4())
        )
    )
    completed = s.run(
        lambda db: VisitService(db, s.clock, s.context).complete(
            checked_in.visit.visit_id,
            VisitCompleteRequest(follow_up=FollowUpCreateInput(due_date=target)),
            idempotency_key=str(uuid4()),
        )
    )
    retained = s.book(patient=s.case.patient_ids[1], target=target)
    before = s.snapshot(retained.appointment_id)
    s.apply([window(capacity=capacity)])
    with pytest.raises(AppError) as error:
        s.run(
            lambda db: FollowUpService(db, s.clock, s.context).book(
                completed.followup.followup_id,
                FollowUpBookRequest(
                    session_definition_id=s.session_id,
                    appointment_date=target,
                    appointment_time=at,
                ),
                idempotency_key=str(uuid4()),
            )
        )
    assert error.value.code == code
    assert s.snapshot(retained.appointment_id) == before
    assert s.availability(target).sessions[0].used_capacity == 1
    assert (
        s.run(lambda db: db.get(FollowUpRecommendation, completed.followup.followup_id).status)
        == "OPEN"
    )


def test_future_plan_edit_uses_effective_limits_while_retaining_occurrence_snapshots(scenario):
    s = scenario
    s.apply([window()])
    planned = s.apply([window()])  # Approved one-change-per-day rule puts this plan next week.
    target = planned.impacts[0].applies_from
    assert target == TARGET_DATE + timedelta(days=7)
    retained = s.book(target=target)
    before = s.snapshot(retained.appointment_id)
    session_id = s.session_id
    s.apply([window(end=time(13), capacity=1)])
    assert s.session_id == session_id
    assert s.snapshot(retained.appointment_id) == before
    effective = s.availability(target).sessions[0]
    assert effective.maximum_capacity == 1 and effective.used_capacity == 1
    assert effective.end_time == time(13)
    with pytest.raises(AppError) as error:
        s.book(time(12), patient=s.case.patient_ids[1], target=target)
    assert error.value.code == "SESSION_FULL"
    s.run(
        lambda db: AppointmentService(db, s.clock, s.context).cancel(
            retained.appointment_id, AppointmentCancelRequest(reason="PATIENT_CANCELLED")
        )
    )
    booked = s.book(time(12), patient=s.case.patient_ids[1], target=target)
    assert booked.appointment_time == time(12)  # Outside the unchanged historical snapshot.
    assert s.availability(target).sessions[0].used_capacity == 1
    assert s.snapshot(retained.appointment_id)[1] == before[1]
    audit = s.run(
        lambda db: db.scalar(
            select(AuditEvent).where(
                AuditEvent.entity_id == booked.appointment_id,
                AuditEvent.action_type == "APPOINTMENT_CREATED",
            )
        )
    )
    assert audit.metadata_json["capacity"] == 1
    assert audit.metadata_json["capacity_before"] == 0


def test_overlapping_empty_sessions_do_not_expose_or_accept_ambiguous_timed_bookings(scenario):
    s = scenario
    s.apply([window(), window(start=time(10, 30), order=1)])
    available = s.availability().sessions[0]
    assert next(slot for slot in available.slots if slot.time == time(10)).available
    assert not next(slot for slot in available.slots if slot.time == time(10, 30)).available
    with pytest.raises(AppError) as error:
        s.book(time(10, 30))
    assert error.value.code == "SCHEDULE_OCCUPANCY_CONFLICT"


def test_preexisting_incompatible_occupancy_fails_closed_in_availability_and_booking(scenario):
    s = scenario
    s.book(time(10, 30))

    # Simulate incompatible data written before this remediation, not an allowed edit.
    def corrupt_legacy_data(db):
        session = db.get(SessionDefinition, s.session_id)
        session.end_time = time(10, 50)
        session.maximum_capacity = 1

    s.run(corrupt_legacy_data)
    with pytest.raises(AppError) as error:
        s.availability()
    assert error.value.code == "SCHEDULE_OCCUPANCY_CONFLICT"
    with pytest.raises(AppError) as error:
        s.book(time(10), patient=s.case.patient_ids[1])
    assert error.value.code == "SCHEDULE_OCCUPANCY_CONFLICT"
    assert (
        s.run(
            lambda db: len(
                db.scalars(
                    select(Appointment).where(Appointment.clinic_id == s.case.clinic_id)
                ).all()
            )
        )
        == 1
    )
