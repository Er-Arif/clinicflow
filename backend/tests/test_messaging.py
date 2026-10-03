import pytest

from app.core.errors import AppError
from app.modules.messaging.defaults import DEFAULT_MESSAGE_TEMPLATES
from app.modules.messaging.models import Reminder
from app.modules.messaging.service import (
    build_whatsapp_url,
    extract_template_variables,
    validate_template_body,
)


def test_whatsapp_url_uses_international_digits_and_prefilled_text() -> None:
    url = build_whatsapp_url("+919876543210", "Hello Rahman")
    assert url == "https://wa.me/919876543210?text=Hello%20Rahman"


def test_template_variables_are_allowlisted() -> None:
    assert extract_template_variables("Hi {patient_name} {appointment_date}") == {
        "patient_name",
        "appointment_date",
    }
    with pytest.raises(AppError) as error:
        validate_template_body("Diagnosis: {diagnosis}")
    assert error.value.code == "UNSUPPORTED_TEMPLATE_VARIABLE"


def test_all_seed_templates_use_supported_variables() -> None:
    for _kind, _language, body in DEFAULT_MESSAGE_TEMPLATES:
        validate_template_body(body)


def test_reminder_has_unique_appointment_and_followup_type_indexes() -> None:
    indexes = {index.name: index for index in Reminder.__table__.indexes}
    assert indexes["uq_reminders_appointment_type"].unique is True
    assert indexes["uq_reminders_followup_type"].unique is True
