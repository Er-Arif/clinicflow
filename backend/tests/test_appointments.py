from datetime import date, time
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.modules.appointments.schemas import (
    AppointmentAdjustFeeRequest,
    AppointmentCancelRequest,
    AppointmentCreateRequest,
    AppointmentRescheduleRequest,
    CapacityOverrideInput,
)
from app.modules.appointments.service import AppointmentService
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


def test_create_appointment_in_past_raises_error() -> None:
    db = MagicMock()
    db.scalar.return_value = None
    clock = MagicMock()
    clock.clinic_date.return_value = date(2026, 10, 6)
    context = MagicMock()
    
    service = AppointmentService(db, clock, context)
    service._patient = MagicMock()
    service._doctor = MagicMock()
    
    request = AppointmentCreateRequest(
        patient_id="00000000-0000-0000-0000-000000000001",
        doctor_id="00000000-0000-0000-0000-000000000002",
        session_definition_id="00000000-0000-0000-0000-000000000003",
        appointment_date=date(2026, 10, 5),
        appointment_time=time(10, 15),
        appointment_type="REGULAR",
    )
    
    with pytest.raises(AppError) as exc_info:
        service.create(request, idempotency_key="key1")
        
    assert exc_info.value.code == "APPOINTMENT_DATE_PAST"

def test_reschedule_appointment_in_past_raises_error() -> None:
    db = MagicMock()
    db.scalar.return_value = None
    clock = MagicMock()
    clock.clinic_date.return_value = date(2026, 10, 6)
    context = MagicMock()
    
    service = AppointmentService(db, clock, context)
    service._locked_appointment = MagicMock()
    service._locked_appointment.return_value.status = "BOOKED"
    
    request = AppointmentRescheduleRequest(
        new_session_definition_id="00000000-0000-0000-0000-000000000003",
        new_appointment_date=date(2026, 10, 5),
        new_appointment_time=time(10, 15),
    )
    
    with pytest.raises(AppError) as exc_info:
        service.reschedule("00000000-0000-0000-0000-000000000004", request, idempotency_key="key2")
        
    assert exc_info.value.code == "APPOINTMENT_DATE_PAST"
