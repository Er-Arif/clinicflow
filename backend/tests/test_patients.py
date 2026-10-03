from datetime import date

import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.modules.patients.phone import normalize_indian_mobile, try_normalize_indian_mobile
from app.modules.patients.schemas import PatientCreateRequest
from app.modules.patients.service import _age_from_dob, _whole_years


def test_indian_mobile_normalization() -> None:
    assert normalize_indian_mobile("98765 43210") == "+919876543210"
    assert normalize_indian_mobile("+91 98765-43210") == "+919876543210"
    assert normalize_indian_mobile("09876543210") == "+919876543210"


def test_invalid_mobile_rejected() -> None:
    with pytest.raises(AppError) as exc:
        normalize_indian_mobile("12345")
    assert exc.value.code == "INVALID_MOBILE_NUMBER"
    assert try_normalize_indian_mobile("patient name") is None


def test_patient_requires_exactly_one_age_source() -> None:
    with pytest.raises(ValidationError):
        PatientCreateRequest(
            full_name="Rahman Ali",
            mobile_number="9876543210",
            approximate_age_years=None,
            date_of_birth=None,
            gender="MALE",
            preferred_language="EN",
        )

    with pytest.raises(ValidationError):
        PatientCreateRequest(
            full_name="Rahman Ali",
            mobile_number="9876543210",
            approximate_age_years=42,
            date_of_birth=date(1984, 1, 1),
            gender="MALE",
            preferred_language="EN",
        )


def test_whatsapp_required_when_different_number_selected() -> None:
    with pytest.raises(ValidationError):
        PatientCreateRequest(
            full_name="Rahman Ali",
            mobile_number="9876543210",
            approximate_age_years=42,
            whatsapp_same_as_mobile=False,
            gender="MALE",
            preferred_language="HI",
        )


def test_age_math() -> None:
    assert _age_from_dob(date(2000, 10, 4), date(2026, 10, 3)) == 25
    assert _age_from_dob(date(2000, 10, 3), date(2026, 10, 3)) == 26
    assert _whole_years(date(2025, 10, 4), date(2026, 10, 3)) == 0
