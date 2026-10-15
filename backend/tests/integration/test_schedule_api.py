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
from app.modules.identity.dependencies import get_auth_context
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
    current_date: date = TARGET_DATE

    def now_utc(self) -> datetime:
        return self.instant

    def clinic_now(self) -> datetime:
        return self.instant

    def clinic_date(self) -> date:
        return self.current_date


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


def _setup_api_client(session_factory, case: ApiCase, clock: FrozenClock | None = None):
    clock = clock or FrozenClock()
    auth_ctx = _context(case)

    def get_test_db():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = get_test_db
    app.dependency_overrides[get_clock] = lambda: clock
    app.dependency_overrides[get_auth_context] = lambda: auth_ctx
    return TestClient(app, raise_server_exceptions=False)


def _stored_schedule_state(session_factory, case: ApiCase) -> dict[str, list[dict]]:
    # Compare every persisted column, including IDs, versions, and operational state.
    with session_factory() as db:
        return {
            model.__tablename__: [
                dict(row)
                for row in db.execute(
                    select(model.__table__)
                    .where(model.__table__.c.clinic_id == case.clinic_id)
                    .order_by(*model.__table__.primary_key.columns)
                ).mappings()
            ]
            for model in (ScheduleDefinition, SessionDefinition, SessionOccurrence, Appointment)
        }


@pytest.mark.parametrize(
    ("suffix", "status_code"), [("", 405), ("/0", 404)], ids=["multi-day", "single-day"]
)
@pytest.mark.parametrize(
    "clinic_date",
    [date(2026, 10, 12), TARGET_DATE, date(2026, 10, 4)],
    ids=["historical", "effective-today", "future-plan"],
)
@pytest.mark.parametrize("edit", ["replace-sessions", "day-off", "deactivate-session"])
def test_retired_legacy_edits_preserve_schedule_and_appointments(
    suffix: str, status_code: int, clinic_date: date, edit: str
) -> None:
    session_factory, engine = _session_factory()
    case = _seed_api_case(session_factory)
    client = _setup_api_client(session_factory, case, FrozenClock(current_date=clinic_date))
    sessions = [
        {
            "session_name": "Changed Morning",
            "start_time": "09:00:00",
            "end_time": "11:00:00",
            "slot_interval_minutes": 30,
            "maximum_capacity": 3,
            "active": edit != "deactivate-session",
            "display_order": 0,
        },
        {
            "session_name": "New Afternoon",
            "start_time": "14:00:00",
            "end_time": "15:00:00",
            "slot_interval_minutes": 20,
            "maximum_capacity": 3,
            "active": True,
            "display_order": 1,
        },
    ]
    payload = {
        "effective_from": TARGET_DATE.isoformat(),
        "sessions": [] if edit == "day-off" else sessions,
    }
    if not suffix:
        # An unscheduled second weekday must not be created either.
        payload["weekdays"] = [0, 1]
    try:
        before = _stored_schedule_state(session_factory, case)
        response = client.put(
            f"/api/v1/doctors/{case.doctor_id}/schedule{suffix}", json=payload
        )
        assert response.status_code == status_code, response.text
        assert _stored_schedule_state(session_factory, case) == before
        # Removing the PUT must preserve the read endpoint used by the mobile app.
        schedule = client.get(
            f"/api/v1/doctors/{case.doctor_id}/schedule",
            params={"effective_on": TARGET_DATE.isoformat()},
        )
        assert schedule.status_code == 200, schedule.text
    finally:
        client.close()
        app.dependency_overrides.clear()
        engine.dispose()
