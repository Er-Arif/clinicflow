from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

import pytest

from app.core.clock import SystemClock
from app.core.errors import AppError
from app.main import app
from app.modules.identity.service import AuthContext
from app.modules.patients.models import Patient
from app.modules.reporting.aggregation import summarize_appointment_status_rows
from app.modules.reporting.schemas import DoctorTodayDetailItem, PatientSummaryBase
from app.modules.reporting.service import ReportingService, _money


def _service() -> ReportingService:
    context = AuthContext(
        user_id=UUID("00000000-0000-0000-0000-000000000001"),
        clinic_id=UUID("00000000-0000-0000-0000-000000000002"),
        session_id=UUID("00000000-0000-0000-0000-000000000003"),
        display_name="Owner",
        roles=frozenset({"OWNER_ADMIN"}),
        permissions=frozenset({"reports.view"}),
        must_change_password=False,
    )
    return ReportingService(None, SystemClock("Asia/Kolkata"), context)  # type: ignore[arg-type]


def test_reporting_money_is_fixed_precision() -> None:
    assert _money(Decimal("500")) == Decimal("500.00")
    assert _money(None) == Decimal("0.00")


def test_appointment_report_aggregation_distinguishes_cancel_outcomes() -> None:
    summary = summarize_appointment_status_rows(
        [
            ("BOOKED", None, 2),
            ("CHECKED_IN", None, 3),
            ("COMPLETED", None, 4),
            ("CANCELLED", None, 5),
            ("CANCELLED", "PATIENT_REQUEST", 6),
            ("CANCELLED", "NO_SHOW", 7),
            ("CANCELLED", "RESCHEDULED", 8),
        ]
    )

    assert summary.total == 35
    assert summary.booked == 2
    assert summary.checked_in == 3
    assert summary.completed == 4
    assert summary.cancelled == 11
    assert summary.no_show == 7
    assert summary.rescheduled == 8


def test_reporting_summaries_allow_missing_mobile() -> None:
    patient = PatientSummaryBase(
        patient_id="00000000-0000-0000-0000-000000000001",
        patient_code="PT-000001",
        full_name="No Phone Patient",
        mobile_number=None,
        gender="MALE",
        age=30,
    )
    today = DoctorTodayDetailItem(
        appointment_id="00000000-0000-0000-0000-000000000002",
        patient_id="00000000-0000-0000-0000-000000000001",
        patient_name="No Phone Patient",
        mobile_number=None,
        gender="MALE",
        age=30,
        appointment_time=None,
        appointment_type="REGULAR",
        status="CHECKED_IN",
    )
    assert patient.mobile_number == ""
    assert today.mobile_number == ""


def test_report_range_allows_same_day() -> None:
    target = date(2026, 10, 3)
    assert ReportingService._validate_range(target, target) == (target, target)


def test_report_range_rejects_reverse_range() -> None:
    with pytest.raises(AppError) as exc:
        ReportingService._validate_range(date(2026, 10, 4), date(2026, 10, 3))
    assert exc.value.code == "INVALID_DATE_RANGE"


def test_report_range_is_bounded() -> None:
    with pytest.raises(AppError) as exc:
        ReportingService._validate_range(date(2025, 1, 1), date(2026, 2, 1))
    assert exc.value.code == "DATE_RANGE_TOO_LARGE"


def test_clinic_day_bounds_are_converted_to_utc() -> None:
    start, end = _service()._utc_bounds(date(2026, 10, 3), date(2026, 10, 3))
    assert start == datetime(2026, 10, 2, 18, 30, tzinfo=UTC)
    assert end == datetime(2026, 10, 3, 18, 30, tzinfo=UTC)


def test_patient_age_uses_clinic_date_for_exact_dob() -> None:
    class FrozenClock:
        def now_utc(self):
            return datetime(2026, 10, 3, tzinfo=UTC)

        def clinic_now(self):
            return datetime(2026, 10, 3, 12, tzinfo=UTC)

        def clinic_date(self):
            return date(2026, 10, 3)

    service = _service()
    service.clock = FrozenClock()  # type: ignore[assignment]
    patient = Patient(
        clinic_id=service.context.clinic_id,
        patient_code="PT-000001",
        full_name="Test Patient",
        mobile_e164="+919876543210",
        whatsapp_e164="+919876543210",
        whatsapp_same_as_mobile=True,
        date_of_birth=date(2000, 10, 4),
        approximate_age_years=None,
        age_as_of_date=None,
        gender="MALE",
        preferred_language="EN",
        reminders_enabled=True,
        created_by=service.context.user_id,
    )
    assert service._patient_age(patient) == 25


def test_m9_reporting_routes_are_registered() -> None:
    paths = set(app.openapi()["paths"].keys())
    expected = {
        "/api/v1/home/assistant",
        "/api/v1/doctor/today",
        "/api/v1/patients/{patient_id}/operational-summary",
        "/api/v1/dashboard/owner",
        "/api/v1/reports/appointments",
        "/api/v1/reports/patients",
        "/api/v1/reports/followups",
        "/api/v1/reports/payments",
        "/api/v1/audit-events",
    }
    assert expected.issubset(paths)
