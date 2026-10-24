"""Cancellation reason safety around appointment time."""

import os
from datetime import UTC, datetime

import pytest

from app.core.errors import AppError
from app.modules.appointments.cancellation_guard import require_valid_cancellation_reason
from tests.integration.test_effective_occupancy import Scenario
from tests.integration.test_transaction_concurrency import FrozenClock, _session_factory

pytestmark = pytest.mark.skipif(
    os.getenv("CLINICFLOW_RUN_INTEGRATION") != "1", reason="Requires migrated PostgreSQL."
)


@pytest.fixture
def scenario():
    factory, engine = _session_factory()
    try:
        yield Scenario(factory)
    finally:
        engine.dispose()


def test_no_show_is_rejected_before_scheduled_appointment_time(scenario):
    s = scenario
    appointment = s.book()

    with pytest.raises(AppError) as error:
        s.run(
            lambda db: require_valid_cancellation_reason(
                db,
                s.context.clinic_id,
                appointment.appointment_id,
                "NO_SHOW",
                s.clock,
            )
        )

    assert error.value.code == "NO_SHOW_TOO_EARLY"


def test_no_show_is_allowed_after_scheduled_appointment_time(scenario):
    s = scenario
    appointment = s.book()
    later_clock = FrozenClock(instant=datetime(2026, 10, 5, 11, 0, tzinfo=UTC))

    s.run(
        lambda db: require_valid_cancellation_reason(
            db,
            s.context.clinic_id,
            appointment.appointment_id,
            "NO_SHOW",
            later_clock,
        )
    )
