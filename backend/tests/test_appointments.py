from datetime import date, time
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.modules.appointments.schemas import (
    AppointmentAdjustFeeRequest,
    AppointmentCancelRequest,
    AppointmentCreateRequest,
    CapacityOverrideInput,
)
from app.modules.idempotency.service import IdempotencyService


def test_appointment_create_normalizes_type() -> None:
    request = AppointmentCreateRequest(
        patient_id="00000000-0000-0000-0000-000000000001",
        doctor_id="00000000-0000-0000-0000-000000000002",
        session_definition_id="00000000-0000-0000-0000-000000000003",
        appointment_date=date(2026, 10, 5),
        appointment_time=time(10, 15),
        appointment_type="regular",
    )
    assert request.appointment_type == "REGULAR"


def test_invalid_appointment_type_rejected() -> None:
    with pytest.raises(ValidationError):
        AppointmentCreateRequest(
            patient_id="00000000-0000-0000-0000-000000000001",
            doctor_id="00000000-0000-0000-0000-000000000002",
            session_definition_id="00000000-0000-0000-0000-000000000003",
            appointment_date=date(2026, 10, 5),
            appointment_time=time(10, 15),
            appointment_type="EMERGENCY",
        )


def test_other_cancellation_requires_note() -> None:
    with pytest.raises(ValidationError):
        AppointmentCancelRequest(reason="OTHER")


def test_rescheduled_is_not_manually_selectable() -> None:
    with pytest.raises(ValidationError):
        AppointmentCancelRequest(reason="RESCHEDULED")


def test_capacity_override_requires_meaningful_reason() -> None:
    with pytest.raises(ValidationError):
        CapacityOverrideInput(reason="x")


def test_fee_adjustment_quantizes_money() -> None:
    request = AppointmentAdjustFeeRequest(amount=Decimal("450"), reason="Doctor approved")
    assert request.amount == Decimal("450.00")


def test_idempotency_hash_is_stable_across_key_order() -> None:
    first = IdempotencyService.request_hash({"b": 2, "a": 1})
    second = IdempotencyService.request_hash({"a": 1, "b": 2})
    assert first == second
