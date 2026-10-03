from datetime import date

import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.modules.payments.models import Payment
from app.modules.visits.models import Visit
from app.modules.visits.schemas import WalkInRequest
from app.modules.visits.service import require_checkin_date


def test_walk_in_type_normalizes() -> None:
    request = WalkInRequest(
        patient_id="00000000-0000-0000-0000-000000000001",
        doctor_id="00000000-0000-0000-0000-000000000002",
        session_definition_id="00000000-0000-0000-0000-000000000003",
        appointment_type="regular",
    )
    assert request.appointment_type == "REGULAR"


def test_walk_in_rejects_unknown_type() -> None:
    with pytest.raises(ValidationError):
        WalkInRequest(
            patient_id="00000000-0000-0000-0000-000000000001",
            doctor_id="00000000-0000-0000-0000-000000000002",
            session_definition_id="00000000-0000-0000-0000-000000000003",
            appointment_type="EMERGENCY",
        )


def test_scheduled_check_in_requires_clinic_date() -> None:
    with pytest.raises(AppError) as error:
        require_checkin_date(date(2026, 10, 4), date(2026, 10, 3))
    assert error.value.code == "CHECK_IN_DATE_MISMATCH"


def test_check_in_same_date_allowed() -> None:
    require_checkin_date(date(2026, 10, 3), date(2026, 10, 3))


def test_visit_has_one_per_appointment_constraint() -> None:
    assert Visit.__table__.c.appointment_id.unique is True


def test_payment_has_current_settlement_unique_index() -> None:
    index = next(
        item for item in Payment.__table__.indexes if item.name == "uq_payments_visit_current_settlement"
    )
    assert index.unique is True
    assert "PENDING" in str(index.dialect_options["postgresql"]["where"])
