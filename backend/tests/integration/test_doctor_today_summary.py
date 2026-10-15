"""Doctor Today read-model totals are independent of its bounded display lists."""

import os
from datetime import UTC, datetime, time
from uuid import uuid4

import pytest

from app.modules.appointments.models import Appointment
from app.modules.reporting.service import ReportingService
from tests.integration.test_effective_occupancy import Scenario
from tests.integration.test_transaction_concurrency import FrozenClock, _session_factory

pytestmark = pytest.mark.skipif(
    os.getenv("CLINICFLOW_RUN_INTEGRATION") != "1", reason="Requires migrated PostgreSQL."
)


def test_today_counts_all_statuses_and_future_bookings_beyond_display_limit():
    factory, engine = _session_factory()
    try:
        scenario = Scenario(factory)
        original = scenario.book()
        # Seed a read-model fixture with explicitly authorized overlapping slots.
        # This test exercises reporting, not booking capacity or lifecycle writes.
        with factory.begin() as db:
            source = db.get(Appointment, original.appointment_id)
            values = {
                column.name: getattr(source, column.name)
                for column in Appointment.__table__.columns
                if column.name not in {"appointment_id", "created_at", "status", "appointment_time"}
            }
            values.update(
                capacity_override_used=True,
                capacity_override_by=scenario.case.user_id,
                capacity_override_at=scenario.clock.now_utc(),
                capacity_override_reason="Authorized overlap fixture",
            )
            rows = [("BOOKED", time(11))] * 105 + [("CHECKED_IN", time(10))] * 103
            rows += [("COMPLETED", time(11)), ("CANCELLED", time(11)), ("BOOKED", None)]
            for status, at in rows:
                db.add(Appointment(appointment_id=uuid4(), status=status, appointment_time=at, **values))
        clock = FrozenClock(instant=datetime(2026, 10, 5, 10, 30, tzinfo=UTC))
        with factory() as db:
            result = ReportingService(db, clock, scenario.context).doctor_today()
        assert result.total_appointments == 212  # Includes the original past booking.
        assert result.checked_in_count == 103
        assert result.upcoming_count == 105
        assert len(result.checked_in) == len(result.upcoming) == 100
        assert all(row.status == "CHECKED_IN" for row in result.checked_in)
        assert all(row.status == "BOOKED" and row.appointment_time == time(11) for row in result.upcoming)
    finally:
        engine.dispose()
