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


def test_multiday_schedule_applies_to_all_selected_days_and_preserves_appointments() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=2)

    # 1. First, book an appointment on TARGET_DATE (Monday, Oct 5)
    def book():
        with session_factory.begin() as db:
            return AppointmentService(db, FrozenClock(), _context(case)).create(
                _create_request(case, case.patient_ids[0], time(10, 0)),
                idempotency_key="multiday-appt-1",
            )

    appt_response = _run_with_request_id(book)
    original_appt_id = appt_response.appointment_id

    # 2. Apply a new multi-day schedule for Mon (0), Wed (2), Fri (4) effective Oct 10
    sessions_payload = [
        SessionWrite(
            session_name="Morning Consultations",
            start_time=time(10, 0),
            end_time=time(13, 0),
            slot_interval_minutes=15,
            maximum_capacity=10,
            active=True,
            display_order=0,
        )
    ]
    multiday_req = MultiDayScheduleReplaceRequest(
        weekdays=[0, 2, 4],
        effective_from=date(2026, 10, 10),
        sessions=sessions_payload,
    )

    def apply_multiday():
        with session_factory.begin() as db:
            return SchedulingService(db, FrozenClock(), _context(case)).replace_multiple_weekdays(
                case.doctor_id, multiday_req
            )

    results = _run_with_request_id(apply_multiday)
    assert len(results) == 3

    # 3. Verify each day (Mon, Wed, Fri) now has the identical schedule definition and sessions
    with session_factory() as db:
        for w in [0, 2, 4]:
            sched = db.scalar(
                select(ScheduleDefinition).where(
                    ScheduleDefinition.clinic_id == case.clinic_id,
                    ScheduleDefinition.doctor_id == case.doctor_id,
                    ScheduleDefinition.weekday == w,
                    ScheduleDefinition.effective_from == date(2026, 10, 10),
                )
            )
            assert sched is not None
            assert sched.active is True
            sess = db.scalars(
                select(SessionDefinition).where(
                    SessionDefinition.schedule_definition_id == sched.schedule_definition_id
                )
            ).all()
            assert len(sess) == 1
            assert sess[0].session_name == "Morning Consultations"
            assert sess[0].start_time == time(10, 0)
            assert sess[0].end_time == time(13, 0)
            assert sess[0].slot_interval_minutes == 15
            assert sess[0].maximum_capacity == 10

        # 4. Verify existing appointment from step 1 was NOT modified or moved
        existing_appt = db.scalar(
            select(Appointment).where(Appointment.appointment_id == original_appt_id)
        )
        assert existing_appt is not None
        assert existing_appt.status == "BOOKED"
        assert existing_appt.appointment_time == time(10, 0)

        # 5. Apply a different schedule group to Tue (1) and Thu (3)
        tue_thu_sessions = [
            SessionWrite(
                session_name="Evening Consultations",
                start_time=time(15, 0),
                end_time=time(18, 0),
                slot_interval_minutes=20,
                maximum_capacity=8,
                active=True,
                display_order=0,
            )
        ]
        tue_thu_req = MultiDayScheduleReplaceRequest(
            weekdays=[1, 3],
            effective_from=date(2026, 10, 10),
            sessions=tue_thu_sessions,
        )

        def apply_tue_thu():
            with session_factory.begin() as db_inner:
                return SchedulingService(db_inner, FrozenClock(), _context(case)).replace_multiple_weekdays(
                    case.doctor_id, tue_thu_req
                )

        _run_with_request_id(apply_tue_thu)

        # Verify Tue and Thu have their separate Evening schedule
        for w in [1, 3]:
            sched = db.scalar(
                select(ScheduleDefinition).where(
                    ScheduleDefinition.clinic_id == case.clinic_id,
                    ScheduleDefinition.doctor_id == case.doctor_id,
                    ScheduleDefinition.weekday == w,
                    ScheduleDefinition.effective_from == date(2026, 10, 10),
                )
            )
            assert sched is not None
            sess = db.scalars(
                select(SessionDefinition).where(
                    SessionDefinition.schedule_definition_id == sched.schedule_definition_id
                )
            ).all()
            assert len(sess) == 1
            assert sess[0].session_name == "Evening Consultations"
            assert sess[0].start_time == time(15, 0)
            assert sess[0].end_time == time(18, 0)

    engine.dispose()


def test_multiday_schedule_operation_is_atomic_on_conflict() -> None:
    session_factory, engine = _session_factory()
    case = _seed_case(session_factory, capacity=1)

    # Pre-create a schedule conflict on Wednesday (weekday 2) on effective_from date 2026-10-15
    with session_factory.begin() as db:
        conflicting_sched = ScheduleDefinition(
            clinic_id=case.clinic_id,
            doctor_id=case.doctor_id,
            weekday=2,
            effective_from=date(2026, 10, 15),
            active=True,
            version=5,
            created_by=case.user_id,
        )
        db.add(conflicting_sched)

    # Now attempt a multi-day update for [1, 2] (Tue, Wed) on effective_from date 2026-10-15
    # Tuesday (1) would succeed on its own, but Wednesday (2) will raise SCHEDULE_EFFECTIVE_DATE_CONFLICT.
    # The atomic transaction must roll back Tuesday completely.
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

    # Verify Tuesday was NOT updated because the transaction rolled back atomically
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
