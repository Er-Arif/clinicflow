from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.modules.clinic.models import Clinic
from app.modules.identity.service import AuthContext
from app.modules.messaging.models import Reminder
from app.modules.messaging.schemas import PreparedMessageResponse
from app.modules.messaging.service import build_whatsapp_url


def ensure_clinic_contact(
    db: Session,
    context: AuthContext,
    prepared: PreparedMessageResponse,
) -> PreparedMessageResponse:
    """Guarantee operational WhatsApp copy carries the configured clinic contact."""
    clinic = db.get(Clinic, context.clinic_id)
    if clinic is None:
        raise RuntimeError("Clinic configuration integrity failure")

    contact = (clinic.contact_number or "").strip()
    if not contact:
        raise AppError(
            "CLINIC_CONTACT_NOT_CONFIGURED",
            "Set the clinic contact number in Clinic settings before sending WhatsApp messages.",
            409,
        )

    message = prepared.rendered_message
    if contact in message:
        return prepared

    label = "संपर्क" if prepared.reminder.language == "HI" else "Contact"
    message = f"{message.rstrip()}\n\n{label}: {contact}"

    reminder = db.get(Reminder, prepared.reminder.reminder_id)
    if reminder is None:
        raise RuntimeError("Reminder integrity failure")
    reminder.message_snapshot = message

    prepared.rendered_message = message
    prepared.reminder.message_snapshot = message
    prepared.whatsapp_url = build_whatsapp_url(prepared.reminder.whatsapp_number, message)
    return prepared
