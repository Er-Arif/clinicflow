from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.modules.payments.models import Receipt, UpiConfiguration
from app.modules.payments.schemas import (
    PaymentConfirmRequest,
    PaymentVoidRequest,
    UpiConfigurationUpdateRequest,
)
from app.modules.payments.service import build_upi_uri, format_receipt_number


def test_payment_method_normalizes() -> None:
    request = PaymentConfirmRequest(payment_method="upi")
    assert request.payment_method == "UPI"


def test_payment_method_rejects_card_in_v1() -> None:
    with pytest.raises(ValidationError):
        PaymentConfirmRequest(payment_method="CARD")


def test_void_requires_meaningful_reason() -> None:
    with pytest.raises(ValidationError):
        PaymentVoidRequest(reason="x")


def test_upi_configuration_validates_upi_id() -> None:
    request = UpiConfigurationUpdateRequest(
        upi_id="clinic@upi",
        payee_name="ClinicFlow Clinic",
        active=True,
    )
    assert request.upi_id == "clinic@upi"
    assert request.expected_version is None


def test_upi_configuration_rejects_invalid_id() -> None:
    with pytest.raises(ValidationError):
        UpiConfigurationUpdateRequest(upi_id="not a upi id", payee_name="Clinic")


def test_receipt_is_unique_per_payment() -> None:
    constraint_names = {constraint.name for constraint in Receipt.__table__.constraints}
    assert "uq_receipts_payment_id" in constraint_names


def test_upi_config_is_unique_per_clinic() -> None:
    constraint_names = {constraint.name for constraint in UpiConfiguration.__table__.constraints}
    assert "uq_upi_configurations_clinic_id" in constraint_names


def test_receipt_number_format() -> None:
    assert format_receipt_number(2026, 41) == "RCT-2026-000041"


def test_upi_uri_uses_authoritative_amount_and_neutral_note() -> None:
    uri = build_upi_uri(
        upi_id="clinic@upi",
        payee_name="ClinicFlow Clinic",
        amount=Decimal("500"),
        reference="CF-ABC123",
    )
    assert uri.startswith("upi://pay?")
    assert "am=500.00" in uri
    assert "tr=CF-ABC123" in uri
    assert "tn=Clinic+Consultation" in uri
    assert "patient" not in uri.lower()
