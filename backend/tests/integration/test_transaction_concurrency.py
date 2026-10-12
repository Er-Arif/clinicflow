from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from decimal import Decimal
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, func, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

from app.core.context import request_id_var
from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.appointments.schemas import AppointmentCreateRequest, AppointmentRescheduleRequest
from app.modules.appointments.service import AppointmentService
from app.modules.audit.models import AuditEvent
from app.modules.clinic.models import Clinic, Doctor
from app.modules.identity.models import User
from app.modules.identity.service import AuthContext
from app.modules.patients.models import Patient
from app.modules.payments.models import Payment, Receipt
from app.modules.payments.schemas import PaymentConfirmRequest
from app.modules.payments.service import PaymentService
from app.modules.scheduling.models import (
    FeeConfiguration,
    ScheduleDefinition,
    SessionDefinition,
    SessionOccurrence,
)
from app.modules.scheduling.schemas import (
    MultiDayScheduleReplaceRequest,
    ScheduleReplaceRequest,
    SessionWrite,
)
from app.modules.scheduling.service import SchedulingService
from app.modules.visits.models import Visit
from app.modules.visits.service import VisitService

RUN_INTEGRATION = os.getenv("CLINICFLOW_RUN_INTEGRATION") == "1"
pytestmark = pytest.mark.skipif(
    not RUN_INTEGRATION,
    reason="Set CLINICFLOW_RUN_INTEGRATION=1 with migrated PostgreSQL to run integration tests.",
)

TARGET_DATE = date(2026, 10, 5)  # Monday


@dataclass(frozen=True, slots=True)
class FrozenClock:
    instant: datetime = datetime(2026, 10, 5, 4, 0, tzinfo=UTC)

    def now_utc(self) -> datetime:
        return self.instant

    def clinic_now(self) -> datetime:
        # Test business date is authoritative; exact offset is not material here.
        return self.instant

    def clinic_date(self) -> date:
        return TARGET_DATE


@dataclass(frozen=True, slots=True)
class Case:
    clinic_id: UUID
    user_id: UUID
    doctor_id: UUID
    patient_ids: tuple[UUID, UUID]
    session_definition_id: UUID
    occurrence_id: UUID


def _session_factory():
    url = os.environ["CLINICFLOW_DATABASE_URL"]
    engine = create_engine(url, pool_pre_ping=True)
    return sessionmaker(bind=engine, expire_on_commit=False), engine


def _context(case: Case) -> AuthContext:
    return AuthContext(
        user_id=case.user_id,
        clinic_id=case.clinic_id,
        session_id=uuid4(),
        display_name="Integration Assistant",
        roles=frozenset({"ASSISTANT"}),
        permissions=frozenset({
            "appointment.create",
            "appointment.check_in",
            "appointment.reschedule",
            "payment.confirm",
            "schedule.manage",
        }),
        must_change_password=False,
    )


def _seed_case(session_factory, *, capacity: int = 1) -> Case:
    suffix = uuid4().hex[:8]
    with session_factory.begin() as db:
        clinic = Clinic(clinic_name=f"Integration Clinic {suffix}")
        db.add(clinic)
        db.flush()
        user = User(
            clinic_id=clinic.clinic_id,
            display_name="Integration Assistant",
            login_identifier=f"integration-{suffix}",
            password_hash="not-used-in-service-test",
            active=True,
        )
        db.add(user)
        db.flush()
        doctor = Doctor(
            clinic_id=clinic.clinic_id,
            display_name="Dr Integration",
            active=True,
        )
        db.add(doctor)
        db.flush()
        patients = []
        for index in (1, 2):
            patient = Patient(
                clinic_id=clinic.clinic_id,
                patient_code=f"PT-I{suffix.upper()}{index}",
                full_name=f"Integration Patient {index}",
                mobile_e164=f"+9198{int(suffix[:6], 16) % 10_000_000:07d}{index}"[:13],
                whatsapp_e164=f"+9198{int(suffix[:6], 16) % 10_000_000:07d}{index}"[:13],
                whatsapp_same_as_mobile=True,
                date_of_birth=date(1990, 1, index),
                approximate_age_years=None,
                age_as_of_date=None,
                gender="MALE",
                preferred_language="EN",
                reminders_enabled=True,
                created_by=user.user_id,
            )
            db.add(patient)
            patients.append(patient)
        db.flush()
        schedule = ScheduleDefinition(
            clinic_id=clinic.clinic_id,
            doctor_id=doctor.doctor_id,
            weekday=0,
            effective_from=date(2026, 10, 1),
            active=True,
            created_by=user.user_id,
        )
        db.add(schedule)
        db.flush()
        definition = SessionDefinition(
            clinic_id=clinic.clinic_id,
            schedule_definition_id=schedule.schedule_definition_id,
            session_name="Morning",
            start_time=time(10, 0),
            end_time=time(11, 0),
            slot_interval_minutes=30,
            maximum_capacity=capacity,
            active=True,
            display_order=0,
        )
        db.add(definition)
        db.flush()
        occurrence = SessionOccurrence(
            clinic_id=clinic.clinic_id,
            doctor_id=doctor.doctor_id,
            session_definition_id=definition.session_definition_id,
            occurrence_date=TARGET_DATE,
            session_name_snapshot="Morning",
            start_time_snapshot=time(10, 0),
            end_time_snapshot=time(11, 0),
            slot_interval_minutes_snapshot=30,
            maximum_capacity_snapshot=capacity,
            status="AVAILABLE",
        )
        db.add(occurrence)
        db.add(
            FeeConfiguration(
                clinic_id=clinic.clinic_id,
                effective_from=date(2026, 10, 1),
                regular_fee=Decimal("500.00"),
                followup_fee=Decimal("300.00"),
                assistant_adjustment_allowed=False,
                created_by=user.user_id,
            )
        )
        db.flush()
        return Case(
            clinic_id=clinic.clinic_id,
            user_id=user.user_id,
            doctor_id=doctor.doctor_id,
            patient_ids=(patients[0].patient_id, patients[1].patient_id),
            session_definition_id=definition.session_definition_id,
            occurrence_id=occurrence.session_occurrence_id,
        )


def _create_request(
    case: Case, patient_id: UUID, appointment_time: time
) -> AppointmentCreateRequest:
    return AppointmentCreateRequest(
        patient_id=patient_id,
        doctor_id=case.doctor_id,
        session_definition_id=case.session_definition_id,
        appointment_date=TARGET_DATE,
        appointment_time=appointment_time,
        appointment_type="REGULAR",
    )


def _run_with_request_id(fn):
    token = request_id_var.set(str(uuid4()))
    try:
        return fn()
    finally:
        request_id_var.reset(token)


def test_two_users_cannot_consume_same_last_slot() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=1)
    barrier = Barrier(2)

    def worker(patient_id: UUID, key: str):
        barrier.wait()
        try:
            def operation():
                with session_factory.begin() as db:
                    return AppointmentService(db, FrozenClock(), _context(case)).create(
                        _create_request(case, patient_id, time(10, 0)), idempotency_key=key
                    )
            return ("ok", _run_with_request_id(operation).appointment_id)
        except AppError as exc:
            return (exc.code, None)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda args: worker(*args),
                [(case.patient_ids[0], "last-slot-a"), (case.patient_ids[1], "last-slot-b")],
            )
        )

    assert sum(result[0] == "ok" for result in results) == 1
    assert any(result[0] in {"SESSION_FULL", "APPOINTMENT_SLOT_UNAVAILABLE"} for result in results)
    with session_factory() as db:
        count = db.scalar(
            select(func.count(Appointment.appointment_id)).where(
                Appointment.clinic_id == case.clinic_id,
                Appointment.session_occurrence_id == case.occurrence_id,
                Appointment.status != "CANCELLED",
            )
        )
        assert count == 1
    engine.dispose()


def test_concurrent_duplicate_appointment_only_one_succeeds() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)
    barrier = Barrier(2)
    same_patient_id = case.patient_ids[0]

    def worker(appt_time: time, key: str):
        barrier.wait()
        try:
            def operation():
                with session_factory.begin() as db:
                    return AppointmentService(db, FrozenClock(), _context(case)).create(
                        _create_request(case, same_patient_id, appt_time), idempotency_key=key
                    )
            return ("ok", _run_with_request_id(operation).appointment_id)
        except AppError as exc:
            return (exc.code, None)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda args: worker(*args),
                [(time(10, 0), "dup-slot-a"), (time(10, 30), "dup-slot-b")],
            )
        )

    assert sum(result[0] == "ok" for result in results) == 1
    assert any(result[0] == "APPOINTMENT_DUPLICATE_ACTIVE" for result in results)
    with session_factory() as db:
        count = db.scalar(
            select(func.count(Appointment.appointment_id)).where(
                Appointment.clinic_id == case.clinic_id,
                Appointment.patient_id == same_patient_id,
                Appointment.status != "CANCELLED",
            )
        )
        assert count == 1
    engine.dispose()


def test_same_idempotency_key_replays_one_appointment() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)
    request = _create_request(case, case.patient_ids[0], time(10, 0))

    def book():
        with session_factory.begin() as db:
            return AppointmentService(db, FrozenClock(), _context(case)).create(
                request, idempotency_key="replay-book"
            )

    first = _run_with_request_id(book)
    second = _run_with_request_id(book)
    assert first.appointment_id == second.appointment_id
    with session_factory() as db:
        count = db.scalar(
            select(func.count(Appointment.appointment_id)).where(
                Appointment.clinic_id == case.clinic_id
            )
        )
        assert count == 1
    engine.dispose()


def test_concurrent_check_in_creates_one_visit_and_one_payment() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)

    def book():
        with session_factory.begin() as db:
            return AppointmentService(db, FrozenClock(), _context(case)).create(
                _create_request(case, case.patient_ids[0], time(10, 0)),
                idempotency_key="checkin-book",
            )

    appointment = _run_with_request_id(book)
    barrier = Barrier(2)

    def worker(key: str):
        barrier.wait()
        try:
            def operation():
                with session_factory.begin() as db:
                    return VisitService(db, FrozenClock(), _context(case)).check_in(
                        appointment.appointment_id, idempotency_key=key
                    )
            return ("ok", _run_with_request_id(operation).visit.visit_id)
        except AppError as exc:
            return (exc.code, None)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(worker, ["checkin-a", "checkin-b"]))

    assert sum(result[0] == "ok" for result in results) == 1
    assert any(result[0] == "VISIT_ALREADY_EXISTS" for result in results)
    with session_factory() as db:
        visits = db.scalars(
            select(Visit).where(Visit.appointment_id == appointment.appointment_id)
        ).all()
        assert len(visits) == 1
        payments = db.scalars(select(Payment).where(Payment.visit_id == visits[0].visit_id)).all()
        assert len(payments) == 1
        assert payments[0].status == "PENDING"
    engine.dispose()


def test_concurrent_payment_confirmation_creates_one_receipt() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)

    def prepare_payment():
        with session_factory.begin() as db:
            appointment = AppointmentService(db, FrozenClock(), _context(case)).create(
                _create_request(case, case.patient_ids[0], time(10, 0)), idempotency_key="pay-book"
            )
        with session_factory.begin() as db:
            checkin = VisitService(db, FrozenClock(), _context(case)).check_in(
                appointment.appointment_id, idempotency_key="pay-checkin"
            )
            return checkin.payment.payment_id

    payment_id = _run_with_request_id(prepare_payment)
    barrier = Barrier(2)

    def worker(key: str):
        barrier.wait()
        try:
            def operation():
                with session_factory.begin() as db:
                    return PaymentService(db, FrozenClock(), _context(case)).confirm(
                        payment_id,
                        PaymentConfirmRequest(payment_method="CASH"),
                        idempotency_key=key,
                    )
            return ("ok", _run_with_request_id(operation).receipt.receipt_id)
        except AppError as exc:
            return (exc.code, None)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(worker, ["confirm-a", "confirm-b"]))

    assert sum(result[0] == "ok" for result in results) == 1
    assert any(result[0] == "PAYMENT_ALREADY_CONFIRMED" for result in results)
    with session_factory() as db:
        receipt_count = db.scalar(
            select(func.count(Receipt.receipt_id)).where(Receipt.payment_id == payment_id)
        )
        assert receipt_count == 1
    engine.dispose()


def test_failed_reschedule_keeps_original_booking_unchanged() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)

    def seed_bookings():
        with session_factory.begin() as db:
            service = AppointmentService(db, FrozenClock(), _context(case))
            first = service.create(
                _create_request(case, case.patient_ids[0], time(10, 0)),
                idempotency_key="rs-first",
            )
        with session_factory.begin() as db:
            second = AppointmentService(db, FrozenClock(), _context(case)).create(
                _create_request(case, case.patient_ids[1], time(10, 30)),
                idempotency_key="rs-second",
            )
        return first, second

    first, _second = _run_with_request_id(seed_bookings)

    def reschedule():
        with session_factory.begin() as db:
            return AppointmentService(db, FrozenClock(), _context(case)).reschedule(
                first.appointment_id,
                AppointmentRescheduleRequest(
                    new_session_definition_id=case.session_definition_id,
                    new_appointment_date=TARGET_DATE,
                    new_appointment_time=time(10, 30),
                ),
                idempotency_key="rs-conflict",
            )

    with pytest.raises(AppError) as error:
        _run_with_request_id(reschedule)
    assert error.value.code == "APPOINTMENT_SLOT_UNAVAILABLE"
    with session_factory() as db:
        original = db.get(Appointment, first.appointment_id)
        assert original is not None
        assert original.status == "BOOKED"
        assert original.rescheduled_to_appointment_id is None
        assert db.scalar(
            select(func.count(Appointment.appointment_id)).where(
                Appointment.rescheduled_from_appointment_id == first.appointment_id
            )
        ) == 0
    engine.dispose()


def test_audit_rows_are_database_immutable() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=1)

    def book():
        with session_factory.begin() as db:
            return AppointmentService(db, FrozenClock(), _context(case)).create(
                _create_request(case, case.patient_ids[0], time(10, 0)),
                idempotency_key="audit-book",
            )

    _run_with_request_id(book)
    with session_factory() as db:
        audit_id = db.scalar(
            select(AuditEvent.audit_id)
            .where(AuditEvent.clinic_id == case.clinic_id)
            .order_by(AuditEvent.occurred_at.asc())
            .limit(1)
        )
        assert audit_id is not None

    with pytest.raises(DBAPIError), session_factory.begin() as db:
        db.execute(
            update(AuditEvent)
            .where(AuditEvent.audit_id == audit_id)
            .values(action_type="TAMPERED")
        )
    engine.dispose()


# 1. create schedule on unscheduled weekday
def test_create_schedule_on_unscheduled_weekday() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)
    req = ScheduleReplaceRequest(
        effective_from=TARGET_DATE,
        sessions=[
            SessionWrite(
                session_name="Saturday Morning",
                start_time=time(10, 0),
                end_time=time(13, 0),
                slot_interval_minutes=15,
                maximum_capacity=8,
                active=True,
                display_order=0,
            )
        ],
    )
    def op():
        with session_factory.begin() as db:
            return SchedulingService(db, FrozenClock(), _context(case)).replace_weekday(
                case.doctor_id, 5, req
            )
    res = _run_with_request_id(op)
    assert res.weekday == 5
    assert res.version == 1
    assert len(res.sessions) == 1
    assert res.sessions[0].session_name == "Saturday Morning"
    engine.dispose()


# 2. replace exact same effective_from version
def test_replace_exact_same_effective_from_version() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)
    req = ScheduleReplaceRequest(
        effective_from=TARGET_DATE,
        sessions=[
            SessionWrite(
                session_name="Morning Consultations",
                start_time=time(10, 0),
                end_time=time(13, 0),
                slot_interval_minutes=15,
                maximum_capacity=10,
                active=True,
                display_order=0,
            )
        ],
    )
    def op():
        with session_factory.begin() as db:
            return SchedulingService(db, FrozenClock(), _context(case)).replace_weekday(
                case.doctor_id, 0, req
            )
    res = _run_with_request_id(op)
    assert res.weekday == 0
    assert res.version == 2
    assert res.effective_from == TARGET_DATE
    engine.dispose()


# 3. same-date replacement changes sessions
def test_same_date_replacement_changes_sessions() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)
    req = ScheduleReplaceRequest(
        effective_from=TARGET_DATE,
        sessions=[
            SessionWrite(
                session_name="Afternoon Clinic",
                start_time=time(14, 0),
                end_time=time(17, 0),
                slot_interval_minutes=20,
                maximum_capacity=6,
                active=True,
                display_order=0,
            )
        ],
    )
    def op():
        with session_factory.begin() as db:
            return SchedulingService(db, FrozenClock(), _context(case)).replace_weekday(
                case.doctor_id, 0, req
            )
    res = _run_with_request_id(op)
    assert len(res.sessions) == 1
    assert res.sessions[0].session_name == "Afternoon Clinic"
    assert res.sessions[0].start_time == time(14, 0)
    assert res.sessions[0].end_time == time(17, 0)
    engine.dispose()


# 4. same-date replacement preserves existing appointment rows exactly
def test_same_date_replacement_preserves_existing_appointment_rows_exactly() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)

    def book():
        with session_factory.begin() as db:
            return AppointmentService(db, FrozenClock(), _context(case)).create(
                _create_request(case, case.patient_ids[0], time(10, 0)),
                idempotency_key="preserve-appt-exact",
            )

    appt = _run_with_request_id(book)
    req = ScheduleReplaceRequest(
        effective_from=TARGET_DATE,
        sessions=[
            SessionWrite(
                session_name="Updated Morning",
                start_time=time(10, 0),
                end_time=time(12, 0),
                slot_interval_minutes=15,
                maximum_capacity=8,
                active=True,
                display_order=0,
            )
        ],
    )
    def replace():
        with session_factory.begin() as db:
            return SchedulingService(db, FrozenClock(), _context(case)).replace_weekday(
                case.doctor_id, 0, req
            )
    _run_with_request_id(replace)
    with session_factory() as db:
        preserved = db.get(Appointment, appt.appointment_id)
        assert preserved is not None
        assert preserved.status == "BOOKED"
        assert preserved.appointment_time == time(10, 0)
        assert preserved.patient_id == case.patient_ids[0]
        assert preserved.session_occurrence_id == case.occurrence_id
    engine.dispose()


# 5. future effective version can be created
def test_future_effective_version_can_be_created() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)
    future_date = date(2026, 10, 19)
    req = ScheduleReplaceRequest(
        effective_from=future_date,
        sessions=[
            SessionWrite(
                session_name="Future Morning",
                start_time=time(9, 0),
                end_time=time(12, 0),
                slot_interval_minutes=30,
                maximum_capacity=5,
                active=True,
                display_order=0,
            )
        ],
    )
    def op():
        with session_factory.begin() as db:
            return SchedulingService(db, FrozenClock(), _context(case)).replace_weekday(
                case.doctor_id, 0, req
            )
    res = _run_with_request_id(op)
    assert res.effective_from == future_date
    assert res.version == 2
    with session_factory() as db:
        prev = db.scalar(
            select(ScheduleDefinition).where(
                ScheduleDefinition.clinic_id == case.clinic_id,
                ScheduleDefinition.doctor_id == case.doctor_id,
                ScheduleDefinition.weekday == 0,
                ScheduleDefinition.effective_from == date(2026, 10, 1),
            )
        )
        assert prev is not None
        assert prev.effective_to == date(2026, 10, 18)
    engine.dispose()


# 6. intermediate date collision with already-planned future version returns deterministic conflict
def test_intermediate_date_collision_with_already_planned_future_version_returns_conflict() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)
    def setup_future():
        with session_factory.begin() as db:
            SchedulingService(db, FrozenClock(), _context(case)).replace_weekday(
                case.doctor_id,
                0,
                ScheduleReplaceRequest(
                    effective_from=date(2026, 10, 20),
                    sessions=[
                        SessionWrite(
                            session_name="Far Future",
                            start_time=time(10, 0),
                            end_time=time(12, 0),
                            slot_interval_minutes=15,
                            maximum_capacity=5,
                            active=True,
                            display_order=0,
                        )
                    ],
                ),
            )
    _run_with_request_id(setup_future)
    collision_req = ScheduleReplaceRequest(
        effective_from=date(2026, 10, 12),
        sessions=[],
    )
    def try_collision():
        with session_factory.begin() as db:
            SchedulingService(db, FrozenClock(), _context(case)).replace_weekday(
                case.doctor_id, 0, collision_req
            )
    with pytest.raises(AppError) as exc_info:
        _run_with_request_id(try_collision)
    assert exc_info.value.code == "SCHEDULE_EFFECTIVE_DATE_CONFLICT"
    engine.dispose()


# 7. multi-day same-date replacement succeeds atomically
def test_multiday_same_date_replacement_succeeds_atomically() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)
    def setup_tue():
        with session_factory.begin() as db:
            SchedulingService(db, FrozenClock(), _context(case)).replace_weekday(
                case.doctor_id,
                1,
                ScheduleReplaceRequest(
                    effective_from=TARGET_DATE,
                    sessions=[
                        SessionWrite(
                            session_name="Tue Old",
                            start_time=time(10, 0),
                            end_time=time(13, 0),
                            slot_interval_minutes=15,
                            maximum_capacity=10,
                            active=True,
                            display_order=0,
                        )
                    ],
                ),
            )
    _run_with_request_id(setup_tue)
    req = MultiDayScheduleReplaceRequest(
        weekdays=[0, 1],
        effective_from=TARGET_DATE,
        sessions=[
            SessionWrite(
                session_name="Morning Consultations",
                start_time=time(11, 0),
                end_time=time(13, 0),
                slot_interval_minutes=15,
                maximum_capacity=8,
                active=True,
                display_order=0,
            )
        ],
    )
    def replace_multi():
        with session_factory.begin() as db:
            return SchedulingService(db, FrozenClock(), _context(case)).replace_multiple_weekdays(
                case.doctor_id, req
            )
    results = _run_with_request_id(replace_multi)
    assert len(results) == 2
    for r in results:
        assert len(r.sessions) == 1
        assert r.sessions[0].start_time == time(11, 0)
        assert r.sessions[0].end_time == time(13, 0)
    engine.dispose()


# 8. conflict on one selected weekday rolls back all selected weekdays
def test_conflict_on_one_selected_weekday_rolls_back_all_selected_weekdays() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=1)
    with session_factory.begin() as db:
        conflicting_sched = ScheduleDefinition(
            clinic_id=case.clinic_id,
            doctor_id=case.doctor_id,
            weekday=2,
            effective_from=date(2026, 10, 20),
            active=True,
            version=5,
            created_by=case.user_id,
        )
        db.add(conflicting_sched)

    failing_req = MultiDayScheduleReplaceRequest(
        weekdays=[1, 2],
        effective_from=date(2026, 10, 15),
        sessions=[],
    )

    def failing_op():
        with session_factory.begin() as db:
            SchedulingService(db, FrozenClock(), _context(case)).replace_multiple_weekdays(
                case.doctor_id, failing_req
            )

    with pytest.raises(AppError) as exc_info:
        _run_with_request_id(failing_op)

    assert exc_info.value.code == "SCHEDULE_EFFECTIVE_DATE_CONFLICT"
    with session_factory() as db:
        tue_sched = db.scalar(
            select(ScheduleDefinition).where(
                ScheduleDefinition.clinic_id == case.clinic_id,
                ScheduleDefinition.doctor_id == case.doctor_id,
                ScheduleDefinition.weekday == 1,
                ScheduleDefinition.effective_from == date(2026, 10, 15),
            )
        )
        assert tue_sched is None, "Tuesday must not be created when transaction fails on Wednesday"
    engine.dispose()


# 9. different weekday groups remain independent
def test_different_weekday_groups_remain_independent() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)

    # Mon/Wed/Fri = Morning
    m_req = MultiDayScheduleReplaceRequest(
        weekdays=[0, 2, 4],
        effective_from=TARGET_DATE,
        sessions=[
            SessionWrite(
                session_name="Morning Consultations",
                start_time=time(10, 0),
                end_time=time(13, 0),
                slot_interval_minutes=15,
                maximum_capacity=10,
                active=True,
                display_order=0,
            )
        ],
    )
    def set_mwf():
        with session_factory.begin() as db:
            SchedulingService(db, FrozenClock(), _context(case)).replace_multiple_weekdays(
                case.doctor_id, m_req
            )
    _run_with_request_id(set_mwf)

    # Tue/Thu = Evening
    t_req = MultiDayScheduleReplaceRequest(
        weekdays=[1, 3],
        effective_from=TARGET_DATE,
        sessions=[
            SessionWrite(
                session_name="Evening Consultations",
                start_time=time(15, 0),
                end_time=time(18, 0),
                slot_interval_minutes=20,
                maximum_capacity=8,
                active=True,
                display_order=0,
            )
        ],
    )
    def set_tt():
        with session_factory.begin() as db:
            SchedulingService(db, FrozenClock(), _context(case)).replace_multiple_weekdays(
                case.doctor_id, t_req
            )
    _run_with_request_id(set_tt)

    # Later modify Tue/Thu to 16:00-19:00
    t_mod_req = MultiDayScheduleReplaceRequest(
        weekdays=[1, 3],
        effective_from=TARGET_DATE,
        sessions=[
            SessionWrite(
                session_name="Evening Consultations",
                start_time=time(16, 0),
                end_time=time(19, 0),
                slot_interval_minutes=20,
                maximum_capacity=8,
                active=True,
                display_order=0,
            )
        ],
    )
    def mod_tt():
        with session_factory.begin() as db:
            SchedulingService(db, FrozenClock(), _context(case)).replace_multiple_weekdays(
                case.doctor_id, t_mod_req
            )
    _run_with_request_id(mod_tt)

    # Verify Mon/Wed/Fri remain unchanged Morning (10:00-13:00)
    with session_factory() as db:
        for w in [0, 2, 4]:
            sched = db.scalar(
                select(ScheduleDefinition).where(
                    ScheduleDefinition.clinic_id == case.clinic_id,
                    ScheduleDefinition.doctor_id == case.doctor_id,
                    ScheduleDefinition.weekday == w,
                    ScheduleDefinition.effective_from == TARGET_DATE,
                )
            )
            assert sched is not None
            sess = db.scalars(
                select(SessionDefinition).where(
                    SessionDefinition.schedule_definition_id == sched.schedule_definition_id,
                    SessionDefinition.active.is_(True),
                )
            ).all()
            assert len(sess) == 1
            assert sess[0].start_time == time(10, 0)
            assert sess[0].end_time == time(13, 0)
    engine.dispose()


# 10. changing start/end time works
def test_changing_start_end_time_works() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)
    req = ScheduleReplaceRequest(
        effective_from=TARGET_DATE,
        sessions=[
            SessionWrite(
                session_name="Extended Session",
                start_time=time(11, 0),
                end_time=time(14, 0),
                slot_interval_minutes=20,
                maximum_capacity=8,
                active=True,
                display_order=0,
            )
        ],
    )
    def op():
        with session_factory.begin() as db:
            return SchedulingService(db, FrozenClock(), _context(case)).replace_weekday(
                case.doctor_id, 0, req
            )
    res = _run_with_request_id(op)
    assert res.sessions[0].start_time == time(11, 0)
    assert res.sessions[0].end_time == time(14, 0)
    engine.dispose()
