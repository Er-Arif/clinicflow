"""Add clinic contact number to unchanged default message templates.

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels = None
depends_on = None


TEMPLATE_UPDATES = [
    (
        "APPOINTMENT_CONFIRMATION",
        "EN",
        "Hello {patient_name},\n\nYour appointment with {doctor_name} at {clinic_name} is booked.\nDate: {appointment_date}\nTime: {appointment_time}\n\nPlease contact the clinic if you are unable to attend.",
        "Hello {patient_name},\n\nYour appointment with {doctor_name} at {clinic_name} is booked.\nDate: {appointment_date}\nTime: {appointment_time}\n\nPlease contact {clinic_name} at {clinic_contact_number} if you are unable to attend.",
    ),
    (
        "APPOINTMENT_CONFIRMATION",
        "HI",
        "नमस्ते {patient_name},\n\n{clinic_name} में {doctor_name} के साथ आपका अपॉइंटमेंट बुक हो गया है।\nदिनांक: {appointment_date}\nसमय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया क्लिनिक से संपर्क करें।",
        "नमस्ते {patient_name},\n\n{clinic_name} में {doctor_name} के साथ आपका अपॉइंटमेंट बुक हो गया है।\nदिनांक: {appointment_date}\nसमय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया {clinic_name} से {clinic_contact_number} पर संपर्क करें।",
    ),
    (
        "APPOINTMENT_REMINDER",
        "EN",
        "Hello {patient_name},\n\nThis is a reminder for your appointment with {doctor_name}.\nDate: {appointment_date}\nTime: {appointment_time}\n\nPlease contact {clinic_name} if you are unable to attend.",
        "Hello {patient_name},\n\nThis is a reminder for your appointment with {doctor_name}.\nDate: {appointment_date}\nTime: {appointment_time}\n\nPlease contact {clinic_name} at {clinic_contact_number} if you are unable to attend.",
    ),
    (
        "APPOINTMENT_REMINDER",
        "HI",
        "नमस्ते {patient_name},\n\nयह {doctor_name} के साथ आपके अपॉइंटमेंट की याद दिलाने वाला संदेश है।\nदिनांक: {appointment_date}\nसमय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया {clinic_name} से संपर्क करें।",
        "नमस्ते {patient_name},\n\nयह {doctor_name} के साथ आपके अपॉइंटमेंट की याद दिलाने वाला संदेश है।\nदिनांक: {appointment_date}\nसमय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया {clinic_name} से {clinic_contact_number} पर संपर्क करें।",
    ),
    (
        "APPOINTMENT_CANCELLED",
        "EN",
        "Hello {patient_name},\n\nYour appointment with {doctor_name} on {appointment_date} at {appointment_time} has been cancelled.\nPlease contact {clinic_name} if you need another appointment.",
        "Hello {patient_name},\n\nYour appointment with {doctor_name} on {appointment_date} at {appointment_time} has been cancelled.\nPlease contact {clinic_name} at {clinic_contact_number} if you need another appointment.",
    ),
    (
        "APPOINTMENT_CANCELLED",
        "HI",
        "नमस्ते {patient_name},\n\n{doctor_name} के साथ {appointment_date} को {appointment_time} वाला आपका अपॉइंटमेंट रद्द कर दिया गया है।\nनया अपॉइंटमेंट चाहिए तो कृपया {clinic_name} से संपर्क करें।",
        "नमस्ते {patient_name},\n\n{doctor_name} के साथ {appointment_date} को {appointment_time} वाला आपका अपॉइंटमेंट रद्द कर दिया गया है।\nनया अपॉइंटमेंट चाहिए तो कृपया {clinic_name} से {clinic_contact_number} पर संपर्क करें।",
    ),
    (
        "APPOINTMENT_RESCHEDULED",
        "EN",
        "Hello {patient_name},\n\nYour appointment with {doctor_name} has been rescheduled.\nNew date: {appointment_date}\nNew time: {appointment_time}\n\nPlease contact {clinic_name} if you are unable to attend.",
        "Hello {patient_name},\n\nYour appointment with {doctor_name} has been rescheduled.\nNew date: {appointment_date}\nNew time: {appointment_time}\n\nPlease contact {clinic_name} at {clinic_contact_number} if you are unable to attend.",
    ),
    (
        "APPOINTMENT_RESCHEDULED",
        "HI",
        "नमस्ते {patient_name},\n\n{doctor_name} के साथ आपका अपॉइंटमेंट बदल दिया गया है।\nनई तारीख: {appointment_date}\nनया समय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया {clinic_name} से संपर्क करें।",
        "नमस्ते {patient_name},\n\n{doctor_name} के साथ आपका अपॉइंटमेंट बदल दिया गया है।\nनई तारीख: {appointment_date}\nनया समय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया {clinic_name} से {clinic_contact_number} पर संपर्क करें।",
    ),
    (
        "FOLLOWUP_REMINDER",
        "EN",
        "Hello {patient_name},\n\nThis is a reminder that your follow-up with {doctor_name} is due around {followup_due_date}.\nPlease contact {clinic_name} to book an appointment.",
        "Hello {patient_name},\n\nThis is a reminder that your follow-up with {doctor_name} is due around {followup_due_date}.\nPlease contact {clinic_name} at {clinic_contact_number} to book an appointment.",
    ),
    (
        "FOLLOWUP_REMINDER",
        "HI",
        "नमस्ते {patient_name},\n\n{doctor_name} के साथ आपका फॉलो-अप लगभग {followup_due_date} को निर्धारित है।\nअपॉइंटमेंट बुक करने के लिए कृपया {clinic_name} से संपर्क करें।",
        "नमस्ते {patient_name},\n\n{doctor_name} के साथ आपका फॉलो-अप लगभग {followup_due_date} को निर्धारित है।\nअपॉइंटमेंट बुक करने के लिए कृपया {clinic_name} से {clinic_contact_number} पर संपर्क करें।",
    ),
]


def _apply(*, reverse: bool) -> None:
    bind = op.get_bind()
    statement = sa.text(
        """
        UPDATE message_templates
        SET template_body = :new_body,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE template_type = :template_type
          AND language = :language
          AND template_body = :old_body
        """
    )
    for template_type, language, old_body, new_body in TEMPLATE_UPDATES:
        if reverse:
            old_body, new_body = new_body, old_body
        bind.execute(
            statement,
            {
                "template_type": template_type,
                "language": language,
                "old_body": old_body,
                "new_body": new_body,
            },
        )


def upgrade() -> None:
    # Only touch rows that still exactly match the original system defaults.
    # Any clinic-customized template is intentionally left untouched.
    _apply(reverse=False)


def downgrade() -> None:
    _apply(reverse=True)
