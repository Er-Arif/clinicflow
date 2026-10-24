from datetime import date
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.core.errors import AppError
from app.modules.clinic.models import Clinic
from app.modules.identity.service import AuthContext
from app.modules.messaging.contact_guard import ensure_clinic_contact
from app.modules.messaging.models import Reminder
from app.modules.messaging.schemas import PreparedMessageResponse, ReminderResponse

CLINIC_ID = UUID("00000000-0000-0000-0000-000000000001")
REMINDER_ID = UUID("00000000-0000-0000-0000-000000000002")
PATIENT_ID = UUID("00000000-0000-0000-0000-000000000003")


class FakeDb:
    def __init__(self, contact: str | None):
        self.clinic = SimpleNamespace(contact_number=contact)
        self.reminder = SimpleNamespace(message_snapshot=None)

    def get(self, model, _key):
        if model is Clinic:
            return self.clinic
        if model is Reminder:
            return self.reminder
        return None


def context() -> AuthContext:
    return AuthContext(
        user_id=UUID("00000000-0000-0000-0000-000000000004"),
        clinic_id=CLINIC_ID,
        session_id=UUID("00000000-0000-0000-0000-000000000005"),
        display_name="Assistant",
        roles=frozenset({"ASSISTANT"}),
        permissions=frozenset({"reminder.manage"}),
        must_change_password=False,
    )


def prepared(message: str, language: str = "EN") -> PreparedMessageResponse:
    reminder = ReminderResponse(
        reminder_id=REMINDER_ID,
        patient_id=PATIENT_ID,
        patient_name="Patient",
        whatsapp_number="+919876543210",
        appointment_id=None,
        followup_id=None,
        reminder_type="APPOINTMENT_CONFIRMATION",
        channel="WHATSAPP_APP",
        language=language,
        due_on=date(2026, 10, 22),
        due_at=None,
        status="DUE",
        message_snapshot=message,
        sent_at=None,
        skipped_at=None,
        skip_reason=None,
        sendable=True,
        suppression_reason=None,
    )
    return PreparedMessageResponse(
        reminder=reminder,
        rendered_message=message,
        whatsapp_url="https://wa.me/919876543210",
    )


def test_missing_clinic_contact_fails_clearly() -> None:
    with pytest.raises(AppError) as exc:
        ensure_clinic_contact(FakeDb(None), context(), prepared("Appointment booked."))
    assert exc.value.code == "CLINIC_CONTACT_NOT_CONFIGURED"


def test_missing_contact_in_custom_template_is_appended_and_snapshotted() -> None:
    db = FakeDb("06432 123456")
    result = ensure_clinic_contact(db, context(), prepared("Appointment booked."))

    assert result.rendered_message == "Appointment booked.\n\nContact: 06432 123456"
    assert result.reminder.message_snapshot == result.rendered_message
    assert db.reminder.message_snapshot == result.rendered_message
    assert "06432%20123456" in result.whatsapp_url


def test_existing_template_contact_is_not_duplicated() -> None:
    db = FakeDb("06432 123456")
    message = "Appointment booked. Contact: 06432 123456"
    result = ensure_clinic_contact(db, context(), prepared(message))
    assert result.rendered_message == message
    assert result.rendered_message.count("06432 123456") == 1
