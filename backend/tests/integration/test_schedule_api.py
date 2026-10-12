from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.clock import get_clock
from app.db.session import get_db
from app.main import app
from app.modules.appointments.models import Appointment
from app.modules.clinic.models import Clinic, Doctor
from app.modules.identity.dependencies import get_auth_context, require_permission
from app.modules.identity.models import User
from app.modules.identity.service import AuthContext
from app.modules.patients.models import Patient
from app.modules.scheduling.models import (
    FeeConfiguration,
    ScheduleDefinition,
    SessionDefinition,
    SessionOccurrence,
)

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
        return self.instant

    def clinic_date(self) -> date:
        return TARGET_DATE


@dataclass(frozen=True, slots=True)
class ApiCase:
    clinic_id: UUID
    user_id: UUID
    doctor_id: UUID
    patient_id: UUID
    session_definition_id: UUID
    occurrence_id: UUID
    appointment_id: UUID


def _session_factory():
    url = os.environ["CLINICFLOW_DATABASE_URL"]
    engine = create_engine(url, pool_pre_ping=True)
    return sessionmaker(bind=engine, expire_on_commit=False), engine


def _context(case: ApiCase) -> AuthContext:
    return AuthContext(
        user_id=case.user_id,
        clinic_id=case.clinic_id,
        session_id=uuid4(),
        display_name="API Doctor",
        roles=frozenset({"DOCTOR", "OWNER_ADMIN"}),
        permissions=frozenset({
            "appointment.create",
            "appointment.read",
            "appointment.check_in",
            "appointment.reschedule",
            "payment.confirm",
            "schedule.manage",
            "fee.manage",
            "session.block",
        }),
        must_change_password=False,
    )


def _seed_api_case(session_factory) -> ApiCase:
    suffix = uuid4().hex[:8]
    with session_factory.begin() as db:
        clinic = Clinic(clinic_name=f"API Clinic {suffix}")
        db.add(clinic)
        db.flush()
        user = User(
            clinic_id=clinic.clinic_id,
            display_name="API Test User",
            login_identifier=f"api-{suffix}",
            password_hash="dummy-hash",
            active=True,
        )
        db.add(user)
        db.flush()
        doctor = Doctor(
            clinic_id=clinic.clinic_id,
            display_name="Dr API Tester",
            active=True,
        )
        db.add(doctor)
        db.flush()
        patient = Patient(
            clinic_id=clinic.clinic_id,
            patient_code=f"PT-API{suffix.upper()}",
            full_name="API Test Patient",
            mobile_e164=f"+9198{int(suffix[:6], 16) % 10_000_000:07d}0"[:13],
            whatsapp_e164=f"+9198{int(suffix[:6], 16) % 10_000_000:07d}0"[:13],
            whatsapp_same_as_mobile=True,
            date_of_birth=date(1990, 1, 1),
            gender="MALE",
            preferred_language="EN",
            reminders_enabled=True,
            created_by=user.user_id,
        )
        db.add(patient)
        db.flush()

        # Seed Monday schedule
        schedule = ScheduleDefinition(
            clinic_id=clinic.clinic_id,
            doctor_id=doctor.doctor_id,
            weekday=0,
            effective_from=TARGET_DATE,
            active=True,
            version=1,
            created_by=user.user_id,
        )
        db.add(schedule)
        db.flush()
        definition = SessionDefinition(
            clinic_id=clinic.clinic_id,
            schedule_definition_id=schedule.schedule_definition_id,
            session_name="Morning Consultations",
            start_time=time(10, 0),
            end_time=time(12, 0),
            slot_interval_minutes=15,
            maximum_capacity=8,
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
            session_name_snapshot="Morning Consultations",
            start_time_snapshot=time(10, 0),
            end_time_snapshot=time(12, 0),
            slot_interval_minutes_snapshot=15,
            maximum_capacity_snapshot=8,
            status="AVAILABLE",
        )
        db.add(occurrence)
        db.flush()
        appointment = Appointment(
            clinic_id=clinic.clinic_id,
            patient_id=patient.patient_id,
            doctor_id=doctor.doctor_id,
            session_occurrence_id=occurrence.session_occurrence_id,
            appointment_time=time(10, 0),
            appointment_type="REGULAR",
            booking_source="ASSISTANT",
            status="BOOKED",
            base_fee_snapshot=Decimal("500.00"),
            effective_fee_amount=Decimal("500.00"),
            created_by=user.user_id,
        )
        db.add(appointment)
        db.add(
            FeeConfiguration(
                clinic_id=clinic.clinic_id,
                effective_from=TARGET_DATE,
                regular_fee=Decimal("500.00"),
                followup_fee=Decimal("300.00"),
                assistant_adjustment_allowed=False,
                created_by=user.user_id,
            )
        )
        db.flush()
        return ApiCase(
            clinic_id=clinic.clinic_id,
            user_id=user.user_id,
            doctor_id=doctor.doctor_id,
            patient_id=patient.patient_id,
            session_definition_id=definition.session_definition_id,
            occurrence_id=occurrence.session_occurrence_id,
            appointment_id=appointment.appointment_id,
        )


def _setup_api_client(session_factory, case: ApiCase):
    clock = FrozenClock()
    auth_ctx = _context(case)

    def get_test_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = get_test_db
    app.dependency_overrides[get_clock] = lambda: clock
    app.dependency_overrides[get_auth_context] = lambda: auth_ctx
    app.dependency_overrides[require_permission("schedule.manage")] = lambda: auth_ctx
    return TestClient(app, raise_server_exceptions=False)


# 1. create schedule via PUT /api/v1/doctors/{id}/schedule
def test_api_create_schedule() -> None:
    session_factory, engine = _session_factory()
    case = _seed_api_case(session_factory)
    client = _setup_api_client(session_factory, case)

    payload = {
        "weekdays": [5],  # Saturday
        "effective_from": TARGET_DATE.isoformat(),
        "sessions": [
            {
                "session_name": "Saturday Morning",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 12,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    response = client.put(f"/api/v1/doctors/{case.doctor_id}/schedule", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data) == 1
    assert data[0]["weekday"] == 5
    assert data[0]["version"] == 1
    assert data[0]["effective_from"] == TARGET_DATE.isoformat()
    assert len(data[0]["sessions"]) == 1
    app.dependency_overrides.clear()
    engine.dispose()


# 2. same-date replacement via PUT /api/v1/doctors/{id}/schedule
def test_api_same_date_replacement() -> None:
    session_factory, engine = _session_factory()
    case = _seed_api_case(session_factory)
    client = _setup_api_client(session_factory, case)

    payload = {
        "weekdays": [0],  # Monday
        "effective_from": TARGET_DATE.isoformat(),
        "sessions": [
            {
                "session_name": "Updated Morning",
                "start_time": "10:00:00",
                "end_time": "12:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    response = client.put(f"/api/v1/doctors/{case.doctor_id}/schedule", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data) == 1
    assert data[0]["weekday"] == 0
    assert data[0]["version"] == 2
    assert data[0]["effective_from"] == TARGET_DATE.isoformat()
    app.dependency_overrides.clear()
    engine.dispose()


# 3. time change via PUT /api/v1/doctors/{id}/schedule
def test_api_time_change() -> None:
    session_factory, engine = _session_factory()
    case = _seed_api_case(session_factory)
    client = _setup_api_client(session_factory, case)

    payload = {
        "weekdays": [0],
        "effective_from": TARGET_DATE.isoformat(),
        "sessions": [
            {
                "session_name": "Morning Consultations",
                "start_time": "11:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    response = client.put(f"/api/v1/doctors/{case.doctor_id}/schedule", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data[0]["sessions"][0]["start_time"] == "11:00:00"
    assert data[0]["sessions"][0]["end_time"] == "13:00:00"
    app.dependency_overrides.clear()
    engine.dispose()


# 4. multi-day replacement via PUT /api/v1/doctors/{id}/schedule
def test_api_multi_day_replacement() -> None:
    session_factory, engine = _session_factory()
    case = _seed_api_case(session_factory)
    client = _setup_api_client(session_factory, case)

    payload = {
        "weekdays": [1, 2, 3, 4, 5, 6],  # Tue-Sun
        "effective_from": TARGET_DATE.isoformat(),
        "sessions": [
            {
                "session_name": "Regular Shift",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 30,
                "maximum_capacity": 6,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    response = client.put(f"/api/v1/doctors/{case.doctor_id}/schedule", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data) == 6
    weekdays_returned = [d["weekday"] for d in data]
    assert weekdays_returned == [1, 2, 3, 4, 5, 6]
    app.dependency_overrides.clear()
    engine.dispose()


# 5. Monday specifically (weekday=0) mapping verified through API
def test_api_monday_specifically() -> None:
    session_factory, engine = _session_factory()
    case = _seed_api_case(session_factory)
    client = _setup_api_client(session_factory, case)

    payload = {
        "weekdays": [0],
        "effective_from": TARGET_DATE.isoformat(),
        "sessions": [
            {
                "session_name": "Monday Exclusive",
                "start_time": "09:00:00",
                "end_time": "12:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 10,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    response = client.put(f"/api/v1/doctors/{case.doctor_id}/schedule", json=payload)
    assert response.status_code == 200
    assert response.json()[0]["weekday"] == 0
    assert response.json()[0]["sessions"][0]["session_name"] == "Monday Exclusive"

    with session_factory() as db:
        sched = db.scalar(
            select(ScheduleDefinition).where(
                ScheduleDefinition.clinic_id == case.clinic_id,
                ScheduleDefinition.doctor_id == case.doctor_id,
                ScheduleDefinition.weekday == 0,
            )
        )
        assert sched is not None
        assert sched.weekday == 0
    app.dependency_overrides.clear()
    engine.dispose()


# 6. existing booked appointment preservation via API
def test_api_preserves_existing_booked_appointment() -> None:
    session_factory, engine = _session_factory()
    case = _seed_api_case(session_factory)
    client = _setup_api_client(session_factory, case)

    payload = {
        "weekdays": [0],
        "effective_from": TARGET_DATE.isoformat(),
        "sessions": [
            {
                "session_name": "Renamed Session",
                "start_time": "10:00:00",
                "end_time": "12:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    response = client.put(f"/api/v1/doctors/{case.doctor_id}/schedule", json=payload)
    assert response.status_code == 200

    with session_factory() as db:
        appt = db.scalar(select(Appointment).where(Appointment.appointment_id == case.appointment_id))
        assert appt is not None
        assert appt.status == "BOOKED"
        assert appt.session_occurrence_id == case.occurrence_id
        assert appt.appointment_time == time(10, 0)
    app.dependency_overrides.clear()
    engine.dispose()


# 7. future version creation via API
def test_api_future_version() -> None:
    session_factory, engine = _session_factory()
    case = _seed_api_case(session_factory)
    client = _setup_api_client(session_factory, case)

    future_date = date(2026, 11, 2)  # Future Monday
    payload = {
        "weekdays": [0],
        "effective_from": future_date.isoformat(),
        "sessions": [
            {
                "session_name": "November Schedule",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 20,
                "maximum_capacity": 9,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    response = client.put(f"/api/v1/doctors/{case.doctor_id}/schedule", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data[0]["version"] == 2
    assert data[0]["effective_from"] == future_date.isoformat()

    with session_factory() as db:
        prev = db.scalar(
            select(ScheduleDefinition).where(
                ScheduleDefinition.clinic_id == case.clinic_id,
                ScheduleDefinition.doctor_id == case.doctor_id,
                ScheduleDefinition.weekday == 0,
                ScheduleDefinition.effective_from == TARGET_DATE,
            )
        )
        assert prev is not None
        assert prev.effective_to == date(2026, 11, 1)
    app.dependency_overrides.clear()
    engine.dispose()


# 8. conflict response shape via API
def test_api_conflict_response_shape() -> None:
    session_factory, engine = _session_factory()
    case = _seed_api_case(session_factory)
    client = _setup_api_client(session_factory, case)

    # First plan future schedule for 2026-11-20
    future_date = date(2026, 11, 20)
    payload_future = {
        "weekdays": [0],
        "effective_from": future_date.isoformat(),
        "sessions": [
            {
                "session_name": "Late Nov",
                "start_time": "10:00:00",
                "end_time": "12:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    res_future = client.put(f"/api/v1/doctors/{case.doctor_id}/schedule", json=payload_future)
    assert res_future.status_code == 200

    # Now attempt intermediate schedule for 2026-11-10 (which collides with 2026-11-20)
    payload_collision = {
        "weekdays": [0],
        "effective_from": "2026-11-10",
        "sessions": [
            {
                "session_name": "Collision",
                "start_time": "10:00:00",
                "end_time": "12:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    response = client.put(f"/api/v1/doctors/{case.doctor_id}/schedule", json=payload_collision)
    assert response.status_code == 409
    body = response.json()
    assert "error" in body
    err = body["error"]
    assert err["code"] == "SCHEDULE_EFFECTIVE_DATE_CONFLICT"
    assert "20 Nov 2026" in err["message"]
    assert err["details"]["conflicting_effective_from"] == "2026-11-20"
    app.dependency_overrides.clear()
    engine.dispose()
