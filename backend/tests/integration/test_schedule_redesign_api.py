from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, date, datetime, time
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.clock import get_clock
from app.core.config import settings
from app.core.security import TokenService
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


@dataclass(frozen=True, slots=True)
class MockClock:
    instant: datetime
    current_date: date

    def now_utc(self) -> datetime:
        return self.instant

    def clinic_now(self) -> datetime:
        return self.instant

    def clinic_date(self) -> date:
        return self.current_date


@dataclass(frozen=True, slots=True)
class RedesignCase:
    clinic_id: UUID
    user_id: UUID
    doctor_id: UUID
    patient_id: UUID


def _session_factory():
    url = os.environ["CLINICFLOW_DATABASE_URL"]
    engine = create_engine(url, pool_pre_ping=True)
    return sessionmaker(bind=engine, expire_on_commit=False), engine


def _context(case: RedesignCase) -> AuthContext:
    return AuthContext(
        user_id=case.user_id,
        clinic_id=case.clinic_id,
        session_id=uuid4(),
        display_name="Redesign Doctor",
        roles=frozenset({"DOCTOR", "OWNER_ADMIN"}),
        permissions=frozenset({
            "appointment.create",
            "appointment.read",
            "schedule.manage",
            "session.block",
        }),
        must_change_password=False,
    )


def _seed_redesign_case(session_factory) -> RedesignCase:
    suffix = uuid4().hex[:8]
    with session_factory.begin() as db:
        clinic = Clinic(clinic_name=f"Redesign Clinic {suffix}")
        db.add(clinic)
        db.flush()
        user = User(
            clinic_id=clinic.clinic_id,
            display_name="Redesign Tester",
            login_identifier=f"redesign-{suffix}",
            password_hash="hash",
            active=True,
        )
        db.add(user)
        db.flush()
        doctor = Doctor(
            clinic_id=clinic.clinic_id,
            display_name="Dr Redesign",
            active=True,
        )
        db.add(doctor)
        db.flush()
        patient = Patient(
            clinic_id=clinic.clinic_id,
            patient_code=f"PT-RD{suffix.upper()}",
            full_name="Redesign Patient",
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
        fee = FeeConfiguration(
            clinic_id=clinic.clinic_id,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            regular_fee=Decimal("500.00"),
            followup_fee=Decimal("300.00"),
            created_by=user.user_id,
        )
        db.add(fee)
        db.flush()
        return RedesignCase(
            clinic_id=clinic.clinic_id,
            user_id=user.user_id,
            doctor_id=doctor.doctor_id,
            patient_id=patient.patient_id,
        )


def _client(session_factory, case: RedesignCase, clock: MockClock) -> TestClient:
    app.dependency_overrides[get_db] = lambda: session_factory()
    app.dependency_overrides[get_clock] = lambda: clock
    app.dependency_overrides[get_auth_context] = lambda: _context(case)
    return TestClient(app)


def _seed_schedule(
    session_factory,
    case: RedesignCase,
    weekday: int,
    effective_from: date,
    effective_to: date | None,
    version: int,
    sessions_data: list[dict[str, Any]],
) -> UUID:
    with session_factory.begin() as db:
        definition = ScheduleDefinition(
            clinic_id=case.clinic_id,
            doctor_id=case.doctor_id,
            weekday=weekday,
            effective_from=effective_from,
            effective_to=effective_to,
            active=bool(sessions_data),
            version=version,
            created_by=case.user_id,
        )
        db.add(definition)
        db.flush()
        for idx, s in enumerate(sessions_data):
            sess = SessionDefinition(
                clinic_id=case.clinic_id,
                schedule_definition_id=definition.schedule_definition_id,
                session_name=s.get("session_name", "Morning"),
                start_time=s.get("start_time", time(10, 0)),
                end_time=s.get("end_time", time(13, 0)),
                slot_interval_minutes=s.get("slot_interval_minutes", 15),
                maximum_capacity=s.get("maximum_capacity", 10),
                active=s.get("active", True),
                display_order=idx,
            )
            db.add(sess)
        db.flush()
        return definition.schedule_definition_id


def _seed_appointment(
    session_factory,
    case: RedesignCase,
    occurrence_date: date,
    appointment_time: time,
    session_def_id: UUID,
) -> UUID:
    with session_factory.begin() as db:
        # Check or create occurrence
        occ = db.scalar(
            select(SessionOccurrence).where(
                SessionOccurrence.session_definition_id == session_def_id,
                SessionOccurrence.occurrence_date == occurrence_date,
            )
        )
        if occ is None:
            sess_def = db.get(SessionDefinition, session_def_id)
            assert sess_def is not None
            occ = SessionOccurrence(
                clinic_id=case.clinic_id,
                doctor_id=case.doctor_id,
                session_definition_id=session_def_id,
                occurrence_date=occurrence_date,
                session_name_snapshot=sess_def.session_name,
                start_time_snapshot=sess_def.start_time,
                end_time_snapshot=sess_def.end_time,
                slot_interval_minutes_snapshot=sess_def.slot_interval_minutes,
                maximum_capacity_snapshot=sess_def.maximum_capacity,
                status="AVAILABLE",
                version=1,
            )
            db.add(occ)
            db.flush()

        appt = Appointment(
            clinic_id=case.clinic_id,
            patient_id=case.patient_id,
            doctor_id=case.doctor_id,
            session_occurrence_id=occ.session_occurrence_id,
            appointment_time=appointment_time,
            appointment_type="REGULAR",
            booking_source="ADMIN",
            status="BOOKED",
            base_fee_snapshot=Decimal("500.00"),
            effective_fee_amount=Decimal("500.00"),
            created_by=case.user_id,
        )
        db.add(appt)
        db.flush()
        return appt.appointment_id


# ---------------------------------------------------------------------------
# 1. SCHEDULE OVERVIEW ENDPOINT
# ---------------------------------------------------------------------------


def _session_content(db, definition_id: UUID) -> list[dict[str, Any]]:
    sessions = db.scalars(
        select(SessionDefinition)
        .where(SessionDefinition.schedule_definition_id == definition_id)
        .order_by(SessionDefinition.display_order)
    ).all()
    return [
        {
            "session_name": session.session_name,
            "start_time": session.start_time.isoformat(),
            "end_time": session.end_time.isoformat(),
            "slot_interval_minutes": session.slot_interval_minutes,
            "maximum_capacity": session.maximum_capacity,
            "active": session.active,
            "display_order": session.display_order,
        }
        for session in sessions
    ]


def test_schedule_overview_endpoint_all_weekdays_and_upcoming():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    t_today = date(2026, 10, 12)  # Monday
    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=t_today)
    client = _client(session_factory, redesign_case, clock)

    # Seed Monday current schedule (v1, from 1 Oct) and upcoming schedule (v2, from 19 Oct)
    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=date(2026, 10, 18),
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 19),
        effective_to=None,
        version=2,
        sessions_data=[{"session_name": "Morning Late", "start_time": time(11, 0), "end_time": time(14, 0)}],
    )

    res = client.get(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/overview")
    assert res.status_code == 200
    data = res.json()
    assert data["doctor_id"] == str(redesign_case.doctor_id)
    assert len(data["days"]) == 7

    mon = next(d for d in data["days"] if d["weekday"] == 0)
    assert mon["weekday_name"] == "Monday"
    assert mon["current"] is not None
    assert mon["current"]["version"] == 1
    assert mon["current"]["effective_from"] == "2026-10-01"
    assert mon["upcoming"] is not None
    assert mon["upcoming"]["version"] == 2
    assert mon["upcoming"]["effective_from"] == "2026-10-19"

    tue = next(d for d in data["days"] if d["weekday"] == 1)
    assert tue["weekday_name"] == "Tuesday"
    assert tue["current"] is None
    assert tue["upcoming"] is None

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 2. HISTORICAL IMMUTABILITY: ACTIVE EDIT CREATES NEW VERSION
# ---------------------------------------------------------------------------


def test_immutability_active_edit_creates_new_version():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    # Monday 1 Oct v1 active
    original_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )

    with session_factory() as db:
        original_sessions = list(db.execute(
            select(SessionDefinition.__table__).where(
                SessionDefinition.schedule_definition_id == original_id
            )
        ).mappings())

    # Today is Monday 12 Oct at 08:30 (before 10:00 start)
    clock = MockClock(instant=datetime(2026, 10, 12, 8, 30, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    # Preview impact
    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning Shifted",
                "start_time": "11:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()
    assert p_data["impacts"][0]["applies_from"] == "2026-10-12"
    assert p_data["impacts"][0]["conflict_detected"] is False
    token = p_data["proposal_token"]

    # Smart-apply
    apply_req = {
        "proposal_token": token,
        "weekdays": [0],
        "sessions": preview_req["sessions"],
    }
    a_res = client.put(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply", json=apply_req)
    assert a_res.status_code == 200, a_res.json()

    # Verify DB state: original row immutable & closed at 11 Oct; new row created effective 12 Oct
    with session_factory() as db:
        defs = db.scalars(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.doctor_id == redesign_case.doctor_id,
                ScheduleDefinition.weekday == 0,
            )
            .order_by(ScheduleDefinition.version)
        ).all()
        assert len(defs) == 2

        v1 = defs[0]
        assert v1.version == 1
        assert v1.effective_from == date(2026, 10, 1)
        assert v1.effective_to == date(2026, 10, 11)  # Closed day before!

        v2 = defs[1]
        assert v2.version == 2
        assert v2.effective_from == date(2026, 10, 12)
        assert v2.effective_to is None
        assert v1.schedule_definition_id == original_id
        assert v2.schedule_definition_id != original_id
        assert _session_content(db, v2.schedule_definition_id) == preview_req["sessions"]
        assert list(db.execute(
            select(SessionDefinition.__table__).where(
                SessionDefinition.schedule_definition_id == original_id
            )
        ).mappings()) == original_sessions

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 3. ONE-CHANGE-PER-DAY: SECOND SAME-DAY EDIT DEFERS TO NEXT WEEK
# ---------------------------------------------------------------------------


def test_one_change_per_day_second_edit_defers_to_next_week():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    # Monday definition already created with effective_from = 2026-10-12 (Version 2)
    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=date(2026, 10, 11),
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 12),
        effective_to=None,
        version=2,
        sessions_data=[{"session_name": "Morning Shifted", "start_time": time(11, 0), "end_time": time(14, 0)}],
    )

    # Second edit attempted on the same day (12 Oct at 09:20)
    clock = MockClock(instant=datetime(2026, 10, 12, 9, 20, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning Further Shifted",
                "start_time": "11:30:00",
                "end_time": "14:30:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()
    # Must defer to next week (19 Oct)
    assert p_data["impacts"][0]["applies_from"] == "2026-10-19"
    assert "already updated" in p_data["impacts"][0]["reason"].lower()

    # Smart-apply succeeds and creates Version 3 effective 19 Oct
    apply_req = {
        "proposal_token": p_data["proposal_token"],
        "weekdays": [0],
        "sessions": preview_req["sessions"],
    }
    a_res = client.put(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply", json=apply_req)
    assert a_res.status_code == 200

    with session_factory() as db:
        defs = db.scalars(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.doctor_id == redesign_case.doctor_id,
                ScheduleDefinition.weekday == 0,
            )
            .order_by(ScheduleDefinition.version)
        ).all()
        assert len(defs) == 3
        v2 = defs[1]
        assert v2.version == 2
        assert v2.effective_from == date(2026, 10, 12)
        assert v2.effective_to == date(2026, 10, 18)  # Clipped

        v3 = defs[2]
        assert v3.version == 3
        assert v3.effective_from == date(2026, 10, 19)
        assert v3.effective_to is None

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 4. FUTURE PLANNED DEFINITIONS EDITED IN-PLACE
# ---------------------------------------------------------------------------


def test_future_planned_definition_edits_in_place_without_version_inflation():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    # Active v1 effective 1 Oct, upcoming planned v2 effective 26 Oct
    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=date(2026, 10, 25),
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 26),
        effective_to=None,
        version=2,
        sessions_data=[{"session_name": "Planned", "start_time": time(11, 0), "end_time": time(14, 0)}],
    )

    # Date is 14 Oct. Doctor edits the planned schedule.
    clock = MockClock(instant=datetime(2026, 10, 14, 10, 0, tzinfo=UTC), current_date=date(2026, 10, 14))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Planned Adjusted",
                "start_time": "12:00:00",
                "end_time": "15:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 10,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()
    assert p_data["impacts"][0]["applies_from"] == "2026-10-26"

    apply_req = {
        "proposal_token": p_data["proposal_token"],
        "weekdays": [0],
        "sessions": preview_req["sessions"],
    }
    a_res = client.put(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply", json=apply_req)
    assert a_res.status_code == 200, a_res.json()

    with session_factory() as db:
        defs = db.scalars(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.doctor_id == redesign_case.doctor_id,
                ScheduleDefinition.weekday == 0,
            )
            .order_by(ScheduleDefinition.version)
        ).all()
        # Still exactly 2 rows! Version 2 updated in-place without creating Version 3!
        assert len(defs) == 2
        assert defs[1].version == 2
        assert defs[1].effective_from == date(2026, 10, 26)

        sessions = db.scalars(
            select(SessionDefinition).where(
                SessionDefinition.schedule_definition_id == defs[1].schedule_definition_id
            )
        ).all()
        assert len(sessions) == 1
        assert sessions[0].session_name == "Planned Adjusted"
        assert sessions[0].start_time == time(12, 0)

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 5. SESSION OCCURRENCE & APPOINTMENT PRESERVATION
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("appointment_date", [date(2026, 10, 5), date(2026, 10, 19)])
def test_appointments_before_edit_retain_original_occurrence_references(appointment_date):
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )

    with session_factory() as db:
        sess_def = db.scalar(
            select(SessionDefinition).where(SessionDefinition.schedule_definition_id == sched_id)
        )
        assert sess_def is not None
        sess_def_id = sess_def.session_definition_id

    # Preserve both past appointments and bookings after the new version takes effect.
    appt_id = _seed_appointment(
        session_factory,
        redesign_case,
        occurrence_date=appointment_date,
        appointment_time=time(10, 15),
        session_def_id=sess_def_id,
    )

    with session_factory() as db:
        original_appointment = dict(db.execute(
            select(Appointment.__table__).where(Appointment.appointment_id == appt_id)
        ).mappings().one())
        original_occurrence = dict(db.execute(
            select(SessionOccurrence.__table__).where(
                SessionOccurrence.session_occurrence_id
                == original_appointment["session_occurrence_id"]
            )
        ).mappings().one())

    # Edit schedule on 12 Oct
    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning New",
                "start_time": "10:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200, p_res.text
    token = p_res.json()["proposal_token"]

    a_res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": token, "weekdays": [0], "sessions": preview_req["sessions"]},
    )

    assert a_res.status_code == 200, a_res.text

    # Verify appointment still points to original occurrence and original session definition
    with session_factory() as db:
        appt = db.get(Appointment, appt_id)
        assert appt is not None
        occ = db.get(SessionOccurrence, appt.session_occurrence_id)
        assert occ is not None
        assert occ.occurrence_date == appointment_date
        assert occ.session_definition_id == sess_def_id
        assert occ.start_time_snapshot == time(10, 0)
        assert dict(db.execute(
            select(Appointment.__table__).where(Appointment.appointment_id == appt_id)
        ).mappings().one()) == original_appointment
        assert dict(db.execute(
            select(SessionOccurrence.__table__).where(
                SessionOccurrence.session_occurrence_id == occ.session_occurrence_id
            )
        ).mappings().one()) == original_occurrence

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 6. SAME-DAY TIMING & SESSION-AWARE EVALUATION
# ---------------------------------------------------------------------------


def test_session_aware_during_and_after_hours_defers_to_next_week():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )

    # Case A: At 11:00 (during 10:00–13:00 session)
    clock_during = MockClock(instant=datetime(2026, 10, 12, 11, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client_during = _client(session_factory, redesign_case, clock_during)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "11:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_during = client_during.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_during.json()["impacts"][0]["applies_from"] == "2026-10-19"

    # Case B: At 14:00 (after 10:00–13:00 session)
    clock_after = MockClock(instant=datetime(2026, 10, 12, 14, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client_after = _client(session_factory, redesign_case, clock_after)

    p_after = client_after.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_after.json()["impacts"][0]["applies_from"] == "2026-10-19"

    a_after = client_after.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": p_after.json()["proposal_token"], "weekdays": [0], "sessions": preview_req["sessions"]},
    )
    assert a_after.status_code == 200
    with session_factory() as db:
        defs = db.scalars(
            select(ScheduleDefinition)
            .where(ScheduleDefinition.doctor_id == redesign_case.doctor_id, ScheduleDefinition.weekday == 0)
            .order_by(ScheduleDefinition.version)
        ).all()
        assert len(defs) == 2
        assert defs[0].effective_to == date(2026, 10, 18)
        assert defs[1].version == 2
        assert defs[1].effective_from == date(2026, 10, 19)

    app.dependency_overrides.clear()
    engine.dispose()


def test_session_aware_morning_finished_evening_unstarted_applies_today():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    # Doctor has Morning (10–13) and Evening (17–20)
    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[
            {"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0), "display_order": 0},
            {"session_name": "Evening", "start_time": time(17, 0), "end_time": time(20, 0), "display_order": 1},
        ],
    )

    # At 14:00 (Morning ended, Evening unstarted), doctor edits Evening to 18:00–21:00
    clock = MockClock(instant=datetime(2026, 10, 12, 14, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 10,
                "active": True,
                "display_order": 0,
            },
            {
                "session_name": "Evening",
                "start_time": "18:00:00",
                "end_time": "21:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 10,
                "active": True,
                "display_order": 1,
            },
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()
    # Evening has not started yet today and Morning is unchanged -> applies today!
    assert p_data["impacts"][0]["applies_from"] == "2026-10-12"

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 7. APPOINTMENT SAFETY: CONFLICT RULES
# ---------------------------------------------------------------------------


def test_appointment_safety_shortening_hours_defers_to_next_week():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    with session_factory() as db:
        sess_def = db.scalar(
            select(SessionDefinition).where(SessionDefinition.schedule_definition_id == sched_id)
        )
        assert sess_def is not None
        sess_def_id = sess_def.session_definition_id

    # Appointment booked for next Monday (19 Oct) at 10:15
    _seed_appointment(
        session_factory,
        redesign_case,
        occurrence_date=date(2026, 10, 19),
        appointment_time=time(10, 15),
        session_def_id=sess_def_id,
    )

    # Doctor on 12 Oct shortens hours: new start is 11:00
    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning Late",
                "start_time": "11:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200, p_res.json()
    p_data = p_res.json()
    # Conflict on 19 Oct -> defers to 26 Oct
    assert p_data["impacts"][0]["conflict_detected"] is True
    assert p_data["impacts"][0]["applies_from"] == "2026-10-26"

    app.dependency_overrides.clear()
    engine.dispose()


def test_appointment_safety_slot_modulo_conflict_defers_to_next_week():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0), "slot_interval_minutes": 15}],
    )
    with session_factory() as db:
        sess_def = db.scalar(
            select(SessionDefinition).where(SessionDefinition.schedule_definition_id == sched_id)
        )
        assert sess_def is not None
        sess_def_id = sess_def.session_definition_id

    # Appointment on 19 Oct at 10:15
    _seed_appointment(
        session_factory,
        redesign_case,
        occurrence_date=date(2026, 10, 19),
        appointment_time=time(10, 15),
        session_def_id=sess_def_id,
    )

    # Doctor changes slot interval to 20 mins. (10:15 - 10:00 = 15 mins. 15 % 20 != 0 -> conflict!)
    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 20,
                "maximum_capacity": 9,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()
    assert p_data["impacts"][0]["conflict_detected"] is True
    assert p_data["impacts"][0]["applies_from"] == "2026-10-26"

    app.dependency_overrides.clear()
    engine.dispose()


def test_appointment_safety_expanding_hours_applies_immediately():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    with session_factory() as db:
        sess_def = db.scalar(
            select(SessionDefinition).where(SessionDefinition.schedule_definition_id == sched_id)
        )
        assert sess_def is not None
        sess_def_id = sess_def.session_definition_id

    # Appointment on 19 Oct at 10:15
    _seed_appointment(
        session_factory,
        redesign_case,
        occurrence_date=date(2026, 10, 19),
        appointment_time=time(10, 15),
        session_def_id=sess_def_id,
    )

    # Doctor expands hours from 09:00 to 14:00 (10:15 is inside hours and matches 15-min interval)
    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning Expanded",
                "start_time": "09:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 20,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()
    assert p_data["impacts"][0]["conflict_detected"] is False
    assert p_data["impacts"][0]["applies_from"] == "2026-10-12"

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 8. MULTI-DAY: MIXED HISTORIES & ATOMICITY
# ---------------------------------------------------------------------------


def test_smart_apply_weekday_groups_remain_independent():
    session_factory, engine = _session_factory()
    case = _seed_redesign_case(session_factory)
    clock = MockClock(datetime(2026, 10, 12, 8, 0, tzinfo=UTC), date(2026, 10, 12))
    client = _client(session_factory, case, clock)
    base_path = f"/api/v1/doctors/{case.doctor_id}/schedule"

    def apply(weekdays, name, start, end):
        payload = {
            "weekdays": weekdays,
            "sessions": [{
                "session_name": name,
                "start_time": start,
                "end_time": end,
                "slot_interval_minutes": 20,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }],
        }
        preview = client.post(f"{base_path}/preview-impact", json=payload)
        assert preview.status_code == 200, preview.text
        result = client.put(
            f"{base_path}/smart-apply",
            json={**payload, "proposal_token": preview.json()["proposal_token"]},
        )
        assert result.status_code == 200, result.text
        return payload["sessions"]

    def other_weekday_rows():
        with session_factory() as db:
            definitions = db.execute(
                select(ScheduleDefinition.__table__).where(
                    ScheduleDefinition.doctor_id == case.doctor_id,
                    ScheduleDefinition.weekday.not_in([1, 3]),
                ).order_by(ScheduleDefinition.weekday)
            ).mappings().all()
            definition_ids = [row["schedule_definition_id"] for row in definitions]
            sessions = db.execute(
                select(SessionDefinition.__table__).where(
                    SessionDefinition.schedule_definition_id.in_(definition_ids)
                ).order_by(SessionDefinition.session_definition_id)
            ).mappings().all()
            return definitions, sessions

    try:
        morning = apply([0, 2, 4], "Morning", "10:00:00", "13:00:00")
        evening = apply([1, 3, 5, 6], "Evening", "15:00:00", "18:00:00")
        with session_factory() as db:
            definitions = db.scalars(select(ScheduleDefinition).where(
                ScheduleDefinition.doctor_id == case.doctor_id
            )).all()
            assert sorted(d.weekday for d in definitions) == list(range(7))
            for definition in definitions:
                expected = morning if definition.weekday in [0, 2, 4] else evening
                assert definition.version == 1
                assert _session_content(db, definition.schedule_definition_id) == expected
            planned_ids = {d.weekday: d.schedule_definition_id for d in definitions if d.weekday in [1, 3]}
        untouched = other_weekday_rows()
        changed = apply([1, 3], "Evening Updated", "16:00:00", "19:00:00")
        assert other_weekday_rows() == untouched
        with session_factory() as db:
            selected = db.scalars(select(ScheduleDefinition).where(
                ScheduleDefinition.doctor_id == case.doctor_id,
                ScheduleDefinition.weekday.in_([1, 3]),
            )).all()
            assert len(selected) == 2
            for definition in selected:
                assert definition.schedule_definition_id == planned_ids[definition.weekday]
                assert definition.version == 1
                assert definition.effective_from > clock.clinic_date()
                assert _session_content(db, definition.schedule_definition_id) == changed
    finally:
        client.close()
        app.dependency_overrides.clear()
        engine.dispose()


def test_multiday_mixed_histories_independent_dates_atomic_success():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    # Monday has booking on 19 Oct
    mon_sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    with session_factory() as db:
        sess_def = db.scalar(
            select(SessionDefinition).where(SessionDefinition.schedule_definition_id == mon_sched_id)
        )
        assert sess_def is not None
        mon_sess_def_id = sess_def.session_definition_id

    _seed_appointment(
        session_factory,
        redesign_case,
        occurrence_date=date(2026, 10, 19),
        appointment_time=time(10, 15),
        session_def_id=mon_sess_def_id,
    )

    # Tuesday has 0 bookings
    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=1,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )

    # Today is Monday 12 Oct at 14:00 (Monday clinic completed; Tuesday tomorrow)
    clock = MockClock(instant=datetime(2026, 10, 12, 14, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    # Doctor edits Mon + Tue hours to 11:00–14:00
    preview_req = {
        "weekdays": [0, 1],
        "sessions": [
            {
                "session_name": "Morning Shifted",
                "start_time": "11:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()

    mon_imp = next(i for i in p_data["impacts"] if i["weekday"] == 0)
    tue_imp = next(i for i in p_data["impacts"] if i["weekday"] == 1)

    # Monday has booking conflict on 19 Oct -> applies 26 Oct
    assert mon_imp["applies_from"] == "2026-10-26"
    assert mon_imp["conflict_detected"] is True

    # Tuesday has 0 bookings -> applies tomorrow 13 Oct!
    assert tue_imp["applies_from"] == "2026-10-13"
    assert tue_imp["conflict_detected"] is False

    # Apply both atomically
    a_res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": p_data["proposal_token"], "weekdays": [0, 1], "sessions": preview_req["sessions"]},
    )
    assert a_res.status_code == 200

    with session_factory() as db:
        for weekday, effective_date in [(0, date(2026, 10, 26)), (1, date(2026, 10, 13))]:
            definitions = db.scalars(
                select(ScheduleDefinition).where(
                    ScheduleDefinition.doctor_id == redesign_case.doctor_id,
                    ScheduleDefinition.weekday == weekday,
                ).order_by(ScheduleDefinition.version)
            ).all()
            assert len(definitions) == 2
            assert definitions[0].version == 1
            assert definitions[1].version == 2
            assert definitions[1].effective_from == effective_date
            assert _session_content(db, definitions[1].schedule_definition_id) == preview_req["sessions"]

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 9. CONCURRENCY: STALE PREVIEW REJECTION
# ---------------------------------------------------------------------------


def test_concurrency_stale_preview_rejected_on_new_appointment():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    with session_factory() as db:
        sess_def = db.scalar(
            select(SessionDefinition).where(SessionDefinition.schedule_definition_id == sched_id)
        )
        assert sess_def is not None
        sess_def_id = sess_def.session_definition_id

    # 1. Doctor requests preview on 12 Oct at 08:00 (no bookings -> safe date is 12 Oct)
    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Shifted",
                "start_time": "11:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    token = p_res.json()["proposal_token"]

    # 2. Concurrently, a receptionist books an appointment at 10:15 on 12 Oct!
    _seed_appointment(
        session_factory,
        redesign_case,
        occurrence_date=date(2026, 10, 12),
        appointment_time=time(10, 15),
        session_def_id=sess_def_id,
    )

    # 3. Doctor submits smart-apply with original token. Authoritative re-evaluation detects conflict!
    apply_req = {
        "proposal_token": token,
        "weekdays": [0],
        "sessions": preview_req["sessions"],
    }
    a_res = client.put(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply", json=apply_req)
    assert a_res.status_code == 409
    assert a_res.json()["error"]["code"] == "STALE_SCHEDULE_PREVIEW"

    app.dependency_overrides.clear()
    engine.dispose()


def test_concurrency_token_expired_rejected():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    # Generate expired token
    expired_claims = {
        "sub": str(redesign_case.doctor_id),
        "cid": str(redesign_case.clinic_id),
        "phash": "dummy",
        "weekdays": [0],
        "expected_states": {},
        "iat": datetime(2026, 10, 12, 7, 0, tzinfo=UTC),
        "exp": datetime(2026, 10, 12, 7, 10, tzinfo=UTC),  # Expired
        "typ": "schedule_proposal",
    }
    expired_token = jwt.encode(expired_claims, settings.access_token_secret, algorithm=settings.jwt_algorithm)

    res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": expired_token, "weekdays": [0], "sessions": []},
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "STALE_SCHEDULE_PREVIEW"

    app.dependency_overrides.clear()
    engine.dispose()


def test_concurrency_token_payload_mismatch_rejected():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    # Request preview for 11:00–14:00
    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "11:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    token = p_res.json()["proposal_token"]

    # Submit smart-apply with different hours (12:00–15:00)
    apply_req = {
        "proposal_token": token,
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "12:00:00",
                "end_time": "15:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    a_res = client.put(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply", json=apply_req)
    assert a_res.status_code == 409
    assert a_res.json()["error"]["code"] == "STALE_SCHEDULE_PREVIEW"

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 15. SESSION-AWARE: ADDITION UNSTARTED APPLIES TODAY, STARTED DEFERS
# ---------------------------------------------------------------------------


def test_session_aware_addition_unstarted_applies_today_started_defers():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    # Active Monday schedule with only Morning (10:00–13:00)
    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )

    # Monday 12 Oct at 14:00 (Morning completed, adding Evening 17:00–20:00)
    clock1 = MockClock(instant=datetime(2026, 10, 12, 14, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client1 = _client(session_factory, redesign_case, clock1)

    preview_req1 = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 10,
                "active": True,
                "display_order": 0,
            },
            {
                "session_name": "Evening",
                "start_time": "17:00:00",
                "end_time": "20:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 10,
                "active": True,
                "display_order": 1,
            },
        ],
    }
    p_res1 = client1.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req1)
    assert p_res1.status_code == 200
    # Unstarted evening addition applies today!
    assert p_res1.json()["impacts"][0]["applies_from"] == "2026-10-12"

    # In contrast, at 18:00 (Afternoon 15:00–17:00 start has already passed)
    clock2 = MockClock(instant=datetime(2026, 10, 12, 18, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client2 = _client(session_factory, redesign_case, clock2)
    preview_req2 = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 10,
                "active": True,
                "display_order": 0,
            },
            {
                "session_name": "Afternoon Passed",
                "start_time": "15:00:00",
                "end_time": "17:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 1,
            },
        ],
    }
    p_res2 = client2.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req2)
    assert p_res2.status_code == 200
    # Passed addition defers to next week!
    assert p_res2.json()["impacts"][0]["applies_from"] == "2026-10-19"

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 16. SESSION-AWARE: REMOVAL UNBOOKED APPLIES TODAY, BOOKED DEFERS
# ---------------------------------------------------------------------------


def test_session_aware_removal_unbooked_applies_today_booked_defers():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[
            {"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)},
            {"session_name": "Evening", "start_time": time(17, 0), "end_time": time(20, 0)},
        ],
    )
    with session_factory() as db:
        sessions = db.scalars(
            select(SessionDefinition).where(SessionDefinition.schedule_definition_id == sched_id).order_by(SessionDefinition.display_order)
        ).all()
        eve_def_id = sessions[1].session_definition_id

    # Scenario A: Evening unbooked at 08:00 today. Removing Evening applies today.
    clock_unbooked = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client_unbooked = _client(session_factory, redesign_case, clock_unbooked)
    req_remove_evening = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 10,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_unbooked = client_unbooked.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=req_remove_evening)
    assert p_unbooked.status_code == 200
    assert p_unbooked.json()["impacts"][0]["applies_from"] == "2026-10-12"

    # Scenario B: Evening has an appointment today (12 Oct). Removing Evening must defer to next week.
    _seed_appointment(
        session_factory,
        redesign_case,
        occurrence_date=date(2026, 10, 12),
        appointment_time=time(17, 15),
        session_def_id=eve_def_id,
    )
    p_booked = client_unbooked.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=req_remove_evening)
    assert p_booked.status_code == 200
    assert p_booked.json()["impacts"][0]["applies_from"] == "2026-10-19"
    assert "Cannot remove a session with existing bookings today" in p_booked.json()["impacts"][0]["reason"]

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 17. CAPACITY DECREASE CONFLICT DEFERS TO NEXT WEEK
# ---------------------------------------------------------------------------


def test_appointment_safety_capacity_decrease_conflict_defers_to_next_week():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0), "maximum_capacity": 8}],
    )
    with session_factory() as db:
        sess_def_id = db.scalar(
            select(SessionDefinition.session_definition_id).where(SessionDefinition.schedule_definition_id == sched_id)
        )

    # Seed 3 appointments on Monday 19 Oct
    for t_val in [time(10, 0), time(10, 15), time(10, 30)]:
        _seed_appointment(
            session_factory,
            redesign_case,
            occurrence_date=date(2026, 10, 19),
            appointment_time=t_val,
            session_def_id=sess_def_id,
        )

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    # Propose capacity decrease to 2 (conflict with 3 booked!)
    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 2,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()
    assert p_data["impacts"][0]["conflict_detected"] is True
    assert p_data["impacts"][0]["applies_from"] == "2026-10-26"
    assert "exceed proposed capacity" in p_data["impacts"][0]["reason"]

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 18. CAPACITY INCREASE APPLIES IMMEDIATELY
# ---------------------------------------------------------------------------


def test_appointment_safety_capacity_increase_applies_immediately():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0), "maximum_capacity": 4}],
    )
    with session_factory() as db:
        sess_def_id = db.scalar(
            select(SessionDefinition.session_definition_id).where(SessionDefinition.schedule_definition_id == sched_id)
        )

    # Seed 2 appointments on Monday 19 Oct
    for t_val in [time(10, 0), time(10, 15)]:
        _seed_appointment(
            session_factory,
            redesign_case,
            occurrence_date=date(2026, 10, 19),
            appointment_time=t_val,
            session_def_id=sess_def_id,
        )

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    # Propose capacity increase to 8
    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()
    assert p_data["impacts"][0]["conflict_detected"] is False
    assert p_data["impacts"][0]["applies_from"] == "2026-10-12"

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 19. DISABLING WEEKDAY APPLIES SAFELY OR DETECTS CONFLICT
# ---------------------------------------------------------------------------


def test_schedule_disabling_weekday_applies_safely_or_detects_conflict():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=1,  # Tuesday
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    with session_factory() as db:
        sess_def_id = db.scalar(
            select(SessionDefinition.session_definition_id).where(SessionDefinition.schedule_definition_id == sched_id)
        )

    # Seed booking on Tuesday 20 Oct
    _seed_appointment(
        session_factory,
        redesign_case,
        occurrence_date=date(2026, 10, 20),
        appointment_time=time(10, 0),
        session_def_id=sess_def_id,
    )

    # Today is Monday 12 Oct
    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    # Disable Tuesday (empty sessions list)
    preview_req = {"weekdays": [1], "sessions": []}
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()
    # Conflicting booking on 20 Oct -> defers past 20 Oct to 27 Oct!
    assert p_data["impacts"][0]["conflict_detected"] is True
    assert p_data["impacts"][0]["applies_from"] == "2026-10-27"
    assert "marked not working" in p_data["impacts"][0]["reason"]

    # Apply
    a_res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": p_data["proposal_token"], "weekdays": [1], "sessions": []},
    )
    assert a_res.status_code == 200, a_res.json()

    # Verify Tuesday active=False ScheduleDefinition created effective 27 Oct
    with session_factory() as db:
        new_def = db.scalar(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.doctor_id == redesign_case.doctor_id,
                ScheduleDefinition.weekday == 1,
                ScheduleDefinition.effective_from == date(2026, 10, 27),
            )
        )
        assert new_def is not None
        assert new_def.active is False

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 20. ADDING UNSCHEDULED WEEKDAY CREATES V1
# ---------------------------------------------------------------------------


def test_schedule_adding_unscheduled_weekday_creates_v1():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    # Doctor has no schedule for Wednesday (weekday 2)
    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [2],
        "sessions": [
            {
                "session_name": "Wednesday Clinic",
                "start_time": "10:00:00",
                "end_time": "13:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    p_data = p_res.json()
    # Nearest Wednesday from 12 Oct is 14 Oct
    assert p_data["impacts"][0]["applies_from"] == "2026-10-14"

    a_res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": p_data["proposal_token"], "weekdays": [2], "sessions": preview_req["sessions"]},
    )
    assert a_res.status_code == 200, a_res.json()

    with session_factory() as db:
        wed_def = db.scalar(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.doctor_id == redesign_case.doctor_id,
                ScheduleDefinition.weekday == 2,
            )
        )
        assert wed_def is not None
        assert _session_content(db, wed_def.schedule_definition_id) == preview_req["sessions"]
        assert wed_def.version == 1
        assert wed_def.effective_from == date(2026, 10, 14)

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 21. MULTI-DAY ROLLBACK ON FAILURE PRESERVES ALL ORIGINAL STATES
# ---------------------------------------------------------------------------


def test_multiday_rollback_on_failure_preserves_all_original_states():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    mon_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    tue_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=1,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    # Tampered proposal token
    invalid_token = "invalid.tampered.token"
    a_res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": invalid_token, "weekdays": [0, 1], "sessions": []},
    )
    assert a_res.status_code == 409

    # Verify both Monday and Tuesday definitions remain completely unchanged
    with session_factory() as db:
        mon = db.get(ScheduleDefinition, mon_id)
        tue = db.get(ScheduleDefinition, tue_id)
        assert mon.effective_to is None
        assert mon.version == 1
        assert tue.effective_to is None
        assert tue.version == 1

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 22. STALE PREVIEW REJECTED ON CONCURRENT SCHEDULE EDIT
# ---------------------------------------------------------------------------


def test_concurrency_stale_preview_rejected_on_concurrent_schedule_edit():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "11:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    token = p_res.json()["proposal_token"]

    # Concurrent transaction increments schedule definition version
    with session_factory.begin() as db:
        curr_def = db.get(ScheduleDefinition, sched_id)
        curr_def.version = 2

    # Smart-apply must detect version mismatch and reject
    a_res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": token, "weekdays": [0], "sessions": preview_req["sessions"]},
    )
    assert a_res.status_code == 409
    assert a_res.json()["error"]["code"] == "STALE_SCHEDULE_PREVIEW"

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 23. STALE PREVIEW REJECTED ON CONCURRENT SESSION BLOCK
# ---------------------------------------------------------------------------


def test_concurrency_stale_preview_rejected_on_concurrent_conflict():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    with session_factory() as db:
        sess_def_id = db.scalar(
            select(SessionDefinition.session_definition_id).where(SessionDefinition.schedule_definition_id == sched_id)
        )

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning",
                "start_time": "11:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    token = p_res.json()["proposal_token"]

    # Before applying, concurrent appointment booked at 10:00 (conflicts with 11:00-14:00)
    _seed_appointment(
        session_factory,
        redesign_case,
        occurrence_date=date(2026, 10, 12),
        appointment_time=time(10, 0),
        session_def_id=sess_def_id,
    )
    # removed block
    # json arg
    # paren
    # assert removed

    # Smart-apply re-evaluates and detects conflict on 12 Oct -> safe date advances to 19 Oct -> 409
    a_res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": token, "weekdays": [0], "sessions": preview_req["sessions"]},
    )
    assert a_res.status_code == 409
    assert a_res.json()["error"]["code"] == "STALE_SCHEDULE_PREVIEW"

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 24. OVERVIEW CURRENT ONLY NO UPCOMING
# ---------------------------------------------------------------------------


def test_schedule_overview_current_only_no_upcoming():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    res = client.get(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/overview")
    assert res.status_code == 200
    mon = next(d for d in res.json()["days"] if d["weekday"] == 0)
    assert mon["current"] is not None
    assert mon["current"]["version"] == 1
    assert mon["upcoming"] is None

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 25. CONCURRENCY: APPOINTMENT BOOKING SERIALIZES WITH SMART-APPLY
# ---------------------------------------------------------------------------


def test_concurrency_appointment_booking_serializes_with_smart_apply():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=0,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    with session_factory() as db:
        sess_def_id = db.scalar(
            select(SessionDefinition.session_definition_id).where(SessionDefinition.schedule_definition_id == sched_id)
        )

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0],
        "sessions": [
            {
                "session_name": "Morning Late",
                "start_time": "11:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    token = p_res.json()["proposal_token"]

    # Book an appointment on Monday 19 Oct at 10:15 (which conflicts with proposed 11:00 start)
    book_res = client.post(
        "/api/v1/appointments",
        headers={"Idempotency-Key": "concurrent-booking-1"},
        json={
            "patient_id": str(redesign_case.patient_id),
            "doctor_id": str(redesign_case.doctor_id),
            "session_definition_id": str(sess_def_id),
            "appointment_date": "2026-10-19",
            "appointment_time": "10:15:00",
            "appointment_type": "REGULAR",
        },
    )
    assert book_res.status_code == 201

    # Smart-apply acquires advisory lock, rescans, sees the newly committed booking, and rejects 409
    a_res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": token, "weekdays": [0], "sessions": preview_req["sessions"]},
    )
    assert a_res.status_code == 409
    assert a_res.json()["error"]["code"] == "STALE_SCHEDULE_PREVIEW"

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 26. CROSS-TOKEN MISUSE: AUTH TOKEN REJECTED AS PROPOSAL TOKEN
# ---------------------------------------------------------------------------


def test_cross_token_misuse_auth_token_rejected_as_proposal_token():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    # Issue real authentication access token
    auth_token = TokenService(clock).create_access_token(
        user_id=redesign_case.user_id,
        clinic_id=redesign_case.clinic_id,
        session_id=uuid4(),
    )

    # Attempt to use auth token as schedule proposal token in smart-apply
    res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": auth_token, "weekdays": [0], "sessions": []},
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "STALE_SCHEDULE_PREVIEW"

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 27. CROSS-TOKEN MISUSE: PROPOSAL TOKEN REJECTED AS AUTH TOKEN
# ---------------------------------------------------------------------------


def test_cross_token_misuse_proposal_token_rejected_as_auth_token():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))

    # Create real proposal token
    from app.modules.scheduling.proposal_tokens import create_proposal_token as _create_proposal_token
    prop_token = _create_proposal_token(
        clinic_id=redesign_case.clinic_id,
        doctor_id=redesign_case.doctor_id,
        payload_hash="dummy",
        weekdays=[0],
        expected_states={},
        now=datetime(2026, 10, 12, 8, 0, tzinfo=UTC),
    )

    # Attempt to use proposal token to authenticate on an endpoint without dependency overrides
    app.dependency_overrides.clear()
    app.dependency_overrides[get_db] = lambda: session_factory()
    app.dependency_overrides[get_clock] = lambda: clock

    unauthed_client = TestClient(app)
    res = unauthed_client.get(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/overview",
        headers={"Authorization": f"Bearer {prop_token}"},
    )
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "AUTHENTICATION_REQUIRED"

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 28. MULTI-DAY ATOMIC ROLLBACK ON WRITE-PHASE FAILURE (CASES E & G)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("first_day_scheduled", [True, False])
def test_multiday_atomic_rollback_on_write_phase_failure(monkeypatch, first_day_scheduled):
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    mon_id = None
    if first_day_scheduled:
        mon_id = _seed_schedule(
            session_factory,
            redesign_case,
            weekday=0,
            effective_from=date(2026, 10, 1),
            effective_to=None,
            version=1,
            sessions_data=[{"session_name": "Morning Mon", "start_time": time(10, 0), "end_time": time(13, 0)}],
        )
    tue_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=1,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning Tue", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )

    if first_day_scheduled:
        # Materialize an available occurrence for Monday 19 Oct to verify occurrence delete rollback
        with session_factory.begin() as db:
            mon_sess_def = db.scalar(
                select(SessionDefinition).where(SessionDefinition.schedule_definition_id == mon_id)
            )
            assert mon_sess_def is not None
            occ = SessionOccurrence(
                clinic_id=redesign_case.clinic_id,
                doctor_id=redesign_case.doctor_id,
                session_definition_id=mon_sess_def.session_definition_id,
                occurrence_date=date(2026, 10, 19),
                session_name_snapshot="Morning Mon",
                start_time_snapshot=time(10, 0),
                end_time_snapshot=time(13, 0),
                slot_interval_minutes_snapshot=15,
                maximum_capacity_snapshot=10,
                status="AVAILABLE",
                version=1,
            )
            db.add(occ)
            db.flush()
            occ_id = occ.session_occurrence_id

    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    preview_req = {
        "weekdays": [0, 1],
        "sessions": [
            {
                "session_name": "Morning Updated",
                "start_time": "11:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)
    assert p_res.status_code == 200
    token = p_res.json()["proposal_token"]

    # Fail at the actual second weekday write, after verifying Monday's writes exist.
    from sqlalchemy.orm import Session as OrmSession
    real_flush = OrmSession.flush
    failed_after_first_day = []

    def failing_flush(self, *args, **kwargs):
        if any(isinstance(row, ScheduleDefinition) and row.weekday == 1 for row in self.new):
            with self.no_autoflush:
                monday = self.scalar(select(ScheduleDefinition).where(
                    ScheduleDefinition.doctor_id == redesign_case.doctor_id,
                    ScheduleDefinition.weekday == 0,
                    ScheduleDefinition.effective_from == date(2026, 10, 12),
                ))
                assert monday is not None
                assert _session_content(self, monday.schedule_definition_id) == preview_req["sessions"]
            failed_after_first_day.append(True)
            raise RuntimeError("Forced database write failure on second weekday")
        return real_flush(self, *args, **kwargs)

    monkeypatch.setattr(OrmSession, "flush", failing_flush)

    apply_req = {
        "proposal_token": token,
        "weekdays": [0, 1],
        "sessions": preview_req["sessions"],
    }
    with pytest.raises(RuntimeError, match="Forced database write failure on second weekday"):
        client.put(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply", json=apply_req)

    monkeypatch.undo()
    assert failed_after_first_day == [True]

    # Prove complete atomic rollback in PostgreSQL transaction:
    with session_factory() as db:
        # 1. Monday definition: effective_to was NOT closed! (remains None)
        mon_defs = db.scalars(
            select(ScheduleDefinition)
            .where(ScheduleDefinition.doctor_id == redesign_case.doctor_id, ScheduleDefinition.weekday == 0)
            .order_by(ScheduleDefinition.version)
        ).all()
        if first_day_scheduled:
            assert len(mon_defs) == 1
            assert mon_defs[0].effective_to is None
            assert mon_defs[0].version == 1
            assert mon_defs[0].schedule_definition_id == mon_id

        else:
            assert mon_defs == []

        # 2. Tuesday definition: effective_to was NOT closed! (remains None)
        tue_defs = db.scalars(
            select(ScheduleDefinition)
            .where(ScheduleDefinition.doctor_id == redesign_case.doctor_id, ScheduleDefinition.weekday == 1)
            .order_by(ScheduleDefinition.version)
        ).all()
        assert len(tue_defs) == 1
        assert tue_defs[0].effective_to is None
        assert tue_defs[0].version == 1
        assert tue_defs[0].schedule_definition_id == tue_id

        if first_day_scheduled:
            # 3. Monday occurrence was NOT deleted!
            occ_check = db.get(SessionOccurrence, occ_id)
            assert occ_check is not None
            assert occ_check.occurrence_date == date(2026, 10, 19)

    app.dependency_overrides.clear()
    engine.dispose()


# ---------------------------------------------------------------------------
# 29. STALE PREVIEW REJECTED WHEN EXCEPTION CREATED AFTER PREVIEW
# ---------------------------------------------------------------------------


def test_stale_preview_rejected_when_exception_created_after_preview():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)

    # 1. Seed doctor schedule for a future candidate date (e.g. Tuesday, weekday 1, active v1)
    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=1,  # Tuesday
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[{"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0)}],
    )
    with session_factory() as db:
        sess_def_id = db.scalar(
            select(SessionDefinition.session_definition_id).where(
                SessionDefinition.schedule_definition_id == sched_id
            )
        )

    # Today is Monday 12 Oct 08:00. The nearest upcoming occurrence of Tuesday is tomorrow (13 Oct).
    clock = MockClock(instant=datetime(2026, 10, 12, 8, 0, tzinfo=UTC), current_date=date(2026, 10, 12))
    client = _client(session_factory, redesign_case, clock)

    # 2. POST schedule/preview-impact
    preview_req = {
        "weekdays": [1],
        "sessions": [
            {
                "session_name": "Morning Shifted",
                "start_time": "11:00:00",
                "end_time": "14:00:00",
                "slot_interval_minutes": 15,
                "maximum_capacity": 8,
                "active": True,
                "display_order": 0,
            }
        ],
    }
    p_res = client.post(f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/preview-impact", json=preview_req)

    # 3. Assert preview succeeds and captures candidate safe date
    assert p_res.status_code == 200
    p_data = p_res.json()
    assert p_data["impacts"][0]["applies_from"] == "2026-10-13"
    assert p_data["impacts"][0]["conflict_detected"] is False
    token = p_data["proposal_token"]

    # 4. AFTER preview, create a date-specific block affecting that candidate date (13 Oct) using block API
    b_res = client.post(
        "/api/v1/session-occurrences/block",
        json={
            "session_definition_id": str(sess_def_id),
            "date": "2026-10-13",
            "reason": "Doctor unavailable - medical conference",
        },
    )
    assert b_res.status_code == 200
    blocked_occ_id = UUID(b_res.json()["session_occurrence_id"])

    # 5. Call PUT schedule/smart-apply with the original proposal token
    a_res = client.put(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/smart-apply",
        json={"proposal_token": token, "weekdays": [1], "sessions": preview_req["sessions"]},
    )

    # 6. Assert HTTP 409 and error.code == "STALE_SCHEDULE_PREVIEW"
    assert a_res.status_code == 409
    assert a_res.json()["error"]["code"] == "STALE_SCHEDULE_PREVIEW"

    # 7. Assert NO schedule mutation occurred:
    #    - original active definition unchanged
    #    - no new ScheduleDefinition
    #    - no effective_to clipping
    with session_factory() as db:
        tue_defs = db.scalars(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.doctor_id == redesign_case.doctor_id,
                ScheduleDefinition.weekday == 1,
            )
            .order_by(ScheduleDefinition.version)
        ).all()
        assert len(tue_defs) == 1
        assert tue_defs[0].schedule_definition_id == sched_id
        assert tue_defs[0].version == 1
        assert tue_defs[0].effective_from == date(2026, 10, 1)
        assert tue_defs[0].effective_to is None

        # 8. Assert the exception/block remains committed independently
        occ = db.get(SessionOccurrence, blocked_occ_id)
        assert occ is not None
        assert occ.status == "BLOCKED"
        assert occ.occurrence_date == date(2026, 10, 13)
        assert occ.block_reason == "Doctor unavailable - medical conference"

    app.dependency_overrides.clear()
    engine.dispose()


def test_exceptions_hub_endpoints_and_lifecycle():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)
    clock = MockClock(instant=datetime(2026, 10, 12, 9, 0, tzinfo=UTC), current_date=date(2026, 10, 12))

    # Seed Tuesday schedule: Morning 10-13, Evening 17-20
    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=1,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[
            {"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0), "slot_interval_minutes": 15, "maximum_capacity": 10, "display_order": 0},
            {"session_name": "Evening", "start_time": time(17, 0), "end_time": time(20, 0), "slot_interval_minutes": 15, "maximum_capacity": 10, "display_order": 1},
        ],
    )

    with session_factory() as db:
        sessions = db.scalars(
            select(SessionDefinition)
            .where(SessionDefinition.schedule_definition_id == sched_id)
            .order_by(SessionDefinition.display_order)
        ).all()
        morn_id = sessions[0].session_definition_id
        eve_id = sessions[1].session_definition_id

    client = _client(session_factory, redesign_case, clock)

    # 1. Book an appointment in Morning session on 2026-10-13
    appt_id = _seed_appointment(
        session_factory, redesign_case, date(2026, 10, 13), time(10, 30), morn_id
    )

    # 2. Query exceptions initially: should be empty
    res = client.get(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions?from_date=2026-10-12"
    )
    assert res.status_code == 200, res.text
    assert res.json()["total_count"] == 0
    assert res.json()["exceptions"] == []

    # 3. Block full day on Tuesday 2026-10-13
    block_res = client.post(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions/block",
        json={
            "date": "2026-10-13",
            "scope": "FULL_DAY",
            "reason": "Doctor at Medical Summit",
        },
    )
    assert block_res.status_code == 200
    block_data = block_res.json()
    assert block_data["scope"] == "FULL_DAY"
    assert block_data["reason"] == "Doctor at Medical Summit"
    assert block_data["status"] == "BLOCKED"
    assert block_data["retained_appointments_count"] == 1
    assert len(block_data["occurrence_ids"]) == 2

    # 4. Duplicate block of the same full day -> 409 DATE_ALREADY_BLOCKED
    dup_res = client.post(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions/block",
        json={
            "date": "2026-10-13",
            "scope": "FULL_DAY",
            "reason": "Doctor at Medical Summit",
        },
    )
    assert dup_res.status_code == 409
    assert dup_res.json()["error"]["code"] == "DATE_ALREADY_BLOCKED"

    # 5. List exceptions -> shows the 1 full day exception with retained_appointments_count == 1
    list_res = client.get(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions?from_date=2026-10-12"
    )
    assert list_res.status_code == 200
    items = list_res.json()["exceptions"]
    assert len(items) == 1
    assert items[0]["scope"] == "FULL_DAY"
    assert items[0]["date"] == "2026-10-13"
    assert items[0]["retained_appointments_count"] == 1
    assert items[0]["status"] == "BLOCKED"

    # 6. Verify existing appointment row is NOT deleted or cancelled
    with session_factory() as db:
        stored_appt = db.get(Appointment, appt_id)
        assert stored_appt is not None
        assert stored_appt.status == "BOOKED"
        assert stored_appt.session_occurrence_id is not None

    # 7. Block a specific session on next Tuesday (2026-10-20, Evening only)
    sess_res = client.post(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions/block",
        json={
            "date": "2026-10-20",
            "scope": "SESSION",
            "session_definition_id": str(eve_id),
            "reason": "Family Dinner",
        },
    )
    assert sess_res.status_code == 200
    sess_data = sess_res.json()
    assert sess_data["scope"] == "SESSION"
    assert sess_data["session_name"] == "Evening"
    assert sess_data["reason"] == "Family Dinner"
    assert sess_data["retained_appointments_count"] == 0

    # 8. Duplicate block of the same session -> 409 SESSION_ALREADY_BLOCKED
    dup_sess_res = client.post(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions/block",
        json={
            "date": "2026-10-20",
            "scope": "SESSION",
            "session_definition_id": str(eve_id),
            "reason": "Family Dinner",
        },
    )
    assert dup_sess_res.status_code == 409
    assert dup_sess_res.json()["error"]["code"] == "SESSION_ALREADY_BLOCKED"

    # 9. List exceptions -> now has 2 exceptions (one FULL_DAY on 13 Oct, one SESSION on 20 Oct)
    list2_res = client.get(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions?from_date=2026-10-12"
    )
    assert list2_res.status_code == 200
    assert list2_res.json()["total_count"] == 2
    assert list2_res.json()["exceptions"][0]["scope"] == "FULL_DAY"
    assert list2_res.json()["exceptions"][1]["scope"] == "SESSION"
    assert list2_res.json()["exceptions"][1]["session_name"] == "Evening"

    # 10. Unblock the full day exception (2026-10-13)
    unblock_res = client.post(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions/unblock",
        json={"occurrence_ids": [str(x) for x in block_data["occurrence_ids"]]},
    )
    assert unblock_res.status_code == 200
    assert unblock_res.json()["unblocked_count"] == 2

    # 11. List exceptions again -> only 1 remaining (the 20 Oct session)
    list3_res = client.get(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions?from_date=2026-10-12"
    )
    assert list3_res.status_code == 200
    assert list3_res.json()["total_count"] == 1
    assert list3_res.json()["exceptions"][0]["date"] == "2026-10-20"

    # 12. Appointment row on 13 Oct is still completely intact
    with session_factory() as db:
        stored_appt = db.get(Appointment, appt_id)
        assert stored_appt is not None
        assert stored_appt.status == "BOOKED"

    engine.dispose()


def test_partial_session_block_to_full_day_block_lifecycle():
    session_factory, engine = _session_factory()
    redesign_case = _seed_redesign_case(session_factory)
    clock = MockClock(instant=datetime(2026, 10, 12, 9, 0, tzinfo=UTC), current_date=date(2026, 10, 12))

    # Thursday schedule: Morning 10-13, Evening 17-20
    sched_id = _seed_schedule(
        session_factory,
        redesign_case,
        weekday=3,
        effective_from=date(2026, 10, 1),
        effective_to=None,
        version=1,
        sessions_data=[
            {"session_name": "Morning", "start_time": time(10, 0), "end_time": time(13, 0), "slot_interval_minutes": 15, "maximum_capacity": 10, "display_order": 0},
            {"session_name": "Evening", "start_time": time(17, 0), "end_time": time(20, 0), "slot_interval_minutes": 15, "maximum_capacity": 10, "display_order": 1},
        ],
    )

    with session_factory() as db:
        sessions = db.scalars(
            select(SessionDefinition)
            .where(SessionDefinition.schedule_definition_id == sched_id)
            .order_by(SessionDefinition.display_order)
        ).all()
        morn_id = sessions[0].session_definition_id
        eve_id = sessions[1].session_definition_id

    client = _client(session_factory, redesign_case, clock)
    target_date = date(2026, 10, 15)

    # Seed appointments in both sessions
    morn_appt_id = _seed_appointment(
        session_factory, redesign_case, target_date, time(10, 30), morn_id
    )
    eve_appt_id = _seed_appointment(
        session_factory, redesign_case, target_date, time(17, 30), eve_id
    )

    # Case A: Morning blocked, Evening open
    morn_res = client.post(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions/block",
        json={
            "date": target_date.isoformat(),
            "scope": "SESSION",
            "session_definition_id": str(morn_id),
            "reason": "Dentist Appointment",
        },
    )
    assert morn_res.status_code == 200
    assert morn_res.json()["scope"] == "SESSION"
    assert morn_res.json()["retained_appointments_count"] == 1

    # Full Day block request when Morning is already blocked and Evening is open
    fullday_res = client.post(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions/block",
        json={
            "date": target_date.isoformat(),
            "scope": "FULL_DAY",
            "reason": "Full Day Emergency Leave",
        },
    )
    assert fullday_res.status_code == 200, fullday_res.text
    fullday_data = fullday_res.json()
    assert fullday_data["scope"] == "FULL_DAY"
    assert fullday_data["status"] == "BLOCKED"
    assert fullday_data["retained_appointments_count"] == 2
    assert len(fullday_data["occurrence_ids"]) == 2

    # Verify Morning's original block reason is preserved, Evening has the new reason
    with session_factory() as db:
        occs = db.scalars(
            select(SessionOccurrence)
            .where(
                SessionOccurrence.doctor_id == redesign_case.doctor_id,
                SessionOccurrence.occurrence_date == target_date,
            )
            .order_by(SessionOccurrence.start_time_snapshot)
        ).all()
        assert len(occs) == 2
        assert occs[0].session_name_snapshot == "Morning"
        assert occs[0].status == "BLOCKED"
        assert occs[0].block_reason == "Dentist Appointment"  # Preserved!
        assert occs[1].session_name_snapshot == "Evening"
        assert occs[1].status == "BLOCKED"
        assert occs[1].block_reason == "Full Day Emergency Leave"

    # Case B: Morning + Evening already blocked -> duplicate Full Day block rejected cleanly
    dup_res = client.post(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions/block",
        json={
            "date": target_date.isoformat(),
            "scope": "FULL_DAY",
            "reason": "Another Full Day Request",
        },
    )
    assert dup_res.status_code == 409
    assert dup_res.json()["error"]["code"] == "DATE_ALREADY_BLOCKED"

    # Case C: Existing appointments in either session remain untouched
    with session_factory() as db:
        morn_appt = db.get(Appointment, morn_appt_id)
        eve_appt = db.get(Appointment, eve_appt_id)
        assert morn_appt is not None
        assert morn_appt.status == "BOOKED"
        assert eve_appt is not None
        assert eve_appt.status == "BOOKED"

    # Expose resulting full-day state in list_exceptions
    list_res = client.get(
        f"/api/v1/doctors/{redesign_case.doctor_id}/schedule/exceptions?from_date=2026-10-12"
    )
    assert list_res.status_code == 200
    exceptions = list_res.json()["exceptions"]
    assert len(exceptions) == 1
    assert exceptions[0]["scope"] == "FULL_DAY"
    assert exceptions[0]["date"] == target_date.isoformat()
    assert exceptions[0]["retained_appointments_count"] == 2
    assert "Dentist Appointment" in exceptions[0]["reason"]
    assert "Full Day Emergency Leave" in exceptions[0]["reason"]

    engine.dispose()
