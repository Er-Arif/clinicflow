from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, date, datetime
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core.context import request_id_var
from app.modules.clinic.models import Clinic
from app.modules.identity.models import User
from app.modules.identity.service import AuthContext
from app.modules.patients.models import NumberCounter, Patient
from app.modules.patients.schemas import PatientCreateRequest
from app.modules.patients.service import PatientService

RUN_INTEGRATION = os.getenv("CLINICFLOW_RUN_INTEGRATION") == "1"
pytestmark = pytest.mark.skipif(
    not RUN_INTEGRATION,
    reason="Set CLINICFLOW_RUN_INTEGRATION=1 with migrated PostgreSQL to run integration tests.",
)


@dataclass(frozen=True, slots=True)
class FrozenClock:
    instant: datetime = datetime(2026, 10, 22, 4, 0, tzinfo=UTC)

    def now_utc(self) -> datetime:
        return self.instant

    def clinic_now(self) -> datetime:
        return self.instant

    def clinic_date(self) -> date:
        return date(2026, 10, 22)


@dataclass(frozen=True, slots=True)
class Seed:
    clinic_id: UUID
    user_id: UUID


def _session_factory():
    url = os.environ["CLINICFLOW_DATABASE_URL"]
    engine = create_engine(url, pool_pre_ping=True)
    return sessionmaker(bind=engine, expire_on_commit=False), engine


def _seed(session_factory) -> Seed:
    suffix = uuid4().hex[:8]
    with session_factory.begin() as db:
        clinic = Clinic(clinic_name=f"Patient Number Clinic {suffix}")
        db.add(clinic)
        db.flush()
        user = User(
            clinic_id=clinic.clinic_id,
            display_name="Patient Number Assistant",
            login_identifier=f"patient-number-{suffix}",
            password_hash="not-used-in-service-test",
            active=True,
        )
        db.add(user)
        db.flush()
        return Seed(clinic_id=clinic.clinic_id, user_id=user.user_id)


def _context(seed: Seed) -> AuthContext:
    return AuthContext(
        user_id=seed.user_id,
        clinic_id=seed.clinic_id,
        session_id=uuid4(),
        display_name="Patient Number Assistant",
        roles=frozenset({"ASSISTANT"}),
        permissions=frozenset({"patient.create", "patient.read"}),
        must_change_password=False,
    )


def _request(name: str, age: int = 30) -> PatientCreateRequest:
    return PatientCreateRequest(
        full_name=name,
        mobile_number=None,
        approximate_age_years=age,
        gender="MALE",
        preferred_language="EN",
    )


def _run_with_request_id(fn):
    token = request_id_var.set(str(uuid4()))
    try:
        return fn()
    finally:
        request_id_var.reset(token)


def test_concurrent_patient_registration_allocates_unique_numbers() -> None:
    session_factory, engine = _session_factory()
    seed = _seed(session_factory)
    barrier = Barrier(2)

    def worker(index: int) -> str:
        barrier.wait()

        def operation() -> str:
            with session_factory.begin() as db:
                patient = PatientService(db, FrozenClock(), _context(seed)).create(
                    _request(f"Concurrent Patient {index}")
                )
                return patient.patient_code

        return _run_with_request_id(operation)

    with ThreadPoolExecutor(max_workers=2) as pool:
        codes = list(pool.map(worker, [1, 2]))

    assert set(codes) == {"0001", "0002"}
    with session_factory() as db:
        stored = db.scalars(
            select(Patient.patient_code)
            .where(Patient.clinic_id == seed.clinic_id)
            .order_by(Patient.patient_code)
        ).all()
        assert stored == ["0001", "0002"]

    engine.dispose()


def test_patient_number_search_supports_short_and_legacy_input() -> None:
    session_factory, engine = _session_factory()
    seed = _seed(session_factory)

    def create() -> str:
        with session_factory.begin() as db:
            return PatientService(db, FrozenClock(), _context(seed)).create(
                _request("Searchable Patient")
            ).patient_code

    assert _run_with_request_id(create) == "0001"

    with session_factory() as db:
        service = PatientService(db, FrozenClock(), _context(seed))
        short = service.search(query="1", limit=20, offset=0)
        padded = service.search(query="0001", limit=20, offset=0)
        legacy = service.search(query="PT-000001", limit=20, offset=0)
        by_name = service.search(query="Searchable", limit=20, offset=0)

    assert [item.patient_code for item in short.items] == ["0001"]
    assert [item.patient_code for item in padded.items] == ["0001"]
    assert [item.patient_code for item in legacy.items] == ["0001"]
    assert [item.patient_code for item in by_name.items] == ["0001"]

    engine.dispose()


def test_patient_number_expands_past_four_digits_without_reset() -> None:
    session_factory, engine = _session_factory()
    seed = _seed(session_factory)

    with session_factory.begin() as db:
        db.add(
            NumberCounter(
                clinic_id=seed.clinic_id,
                counter_key="PATIENT",
                last_value=9999,
            )
        )

    def create() -> str:
        with session_factory.begin() as db:
            return PatientService(db, FrozenClock(), _context(seed)).create(
                _request("Five Digit Patient")
            ).patient_code

    assert _run_with_request_id(create) == "10000"

    with session_factory() as db:
        counter = db.get(NumberCounter, (seed.clinic_id, "PATIENT"))
        assert counter is not None
        assert counter.last_value == 10000

    engine.dispose()


def test_patient_counters_remain_clinic_scoped() -> None:
    session_factory, engine = _session_factory()
    first = _seed(session_factory)
    second = _seed(session_factory)

    def create(seed: Seed, name: str) -> str:
        with session_factory.begin() as db:
            return PatientService(db, FrozenClock(), _context(seed)).create(
                _request(name)
            ).patient_code

    assert _run_with_request_id(lambda: create(first, "First Clinic Patient")) == "0001"
    assert _run_with_request_id(lambda: create(second, "Second Clinic Patient")) == "0001"

    engine.dispose()
