"""M8 messaging templates and reminders.

Revision ID: 0008
Revises: 0007
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "message_templates",
        sa.Column("template_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("template_type", sa.String(40), nullable=False),
        sa.Column("language", sa.String(2), nullable=False),
        sa.Column("template_body", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("language IN ('EN', 'HI')", name="ck_message_templates_language_allowed"),
        sa.CheckConstraint(
            "template_type IN ('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_RESCHEDULED', 'FOLLOWUP_REMINDER')",
            name="ck_message_templates_template_type_allowed",
        ),
        sa.UniqueConstraint("clinic_id", "template_type", "language", name="uq_message_templates_clinic_type_language"),
    )
    op.create_index("ix_message_templates_clinic_id", "message_templates", ["clinic_id"])

    op.create_table(
        "reminders",
        sa.Column("reminder_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("patient_id", sa.Uuid(), sa.ForeignKey("patients.patient_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), sa.ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("followup_id", sa.Uuid(), sa.ForeignKey("followup_recommendations.followup_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("reminder_type", sa.String(40), nullable=False),
        sa.Column("channel", sa.String(30), nullable=False, server_default="WHATSAPP_APP"),
        sa.Column("language", sa.String(2), nullable=False),
        sa.Column("due_on", sa.Date(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="DUE"),
        sa.Column("message_snapshot", sa.Text(), nullable=True),
        sa.Column("sent_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("skipped_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("skipped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("skip_reason", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "reminder_type IN ('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_RESCHEDULED', 'FOLLOWUP_REMINDER')",
            name="ck_reminders_reminder_type_allowed",
        ),
        sa.CheckConstraint("channel IN ('WHATSAPP_APP')", name="ck_reminders_channel_allowed"),
        sa.CheckConstraint("language IN ('EN', 'HI')", name="ck_reminders_language_allowed"),
        sa.CheckConstraint("status IN ('DUE', 'SENT', 'SKIPPED')", name="ck_reminders_status_allowed"),
        sa.CheckConstraint(
            "(appointment_id IS NOT NULL AND followup_id IS NULL) OR (appointment_id IS NULL AND followup_id IS NOT NULL)",
            name="ck_reminders_exactly_one_reference",
        ),
        sa.CheckConstraint(
            "(status = 'DUE' AND sent_by IS NULL AND sent_at IS NULL AND skipped_at IS NULL) "
            "OR (status = 'SENT' AND sent_by IS NOT NULL AND sent_at IS NOT NULL AND skipped_at IS NULL) "
            "OR (status = 'SKIPPED' AND sent_by IS NULL AND sent_at IS NULL AND skipped_at IS NOT NULL)",
            name="ck_reminders_state_shape_valid",
        ),
    )
    op.create_index("ix_reminders_clinic_id", "reminders", ["clinic_id"])
    op.create_index("ix_reminders_patient_id", "reminders", ["patient_id"])
    op.create_index("ix_reminders_appointment_id", "reminders", ["appointment_id"])
    op.create_index("ix_reminders_followup_id", "reminders", ["followup_id"])
    op.create_index("ix_reminders_clinic_status_due", "reminders", ["clinic_id", "status", "due_on"])
    op.create_index(
        "uq_reminders_appointment_type",
        "reminders",
        ["appointment_id", "reminder_type"],
        unique=True,
        postgresql_where=sa.text("appointment_id IS NOT NULL"),
    )
    op.create_index(
        "uq_reminders_followup_type",
        "reminders",
        ["followup_id", "reminder_type"],
        unique=True,
        postgresql_where=sa.text("followup_id IS NOT NULL"),
    )

    # Seed defaults for existing clinics using the first staff user as updater.
    op.execute(
        sa.text(
            "INSERT INTO message_templates (template_id, clinic_id, template_type, language, template_body, active, version, updated_by) "
            "SELECT gen_random_uuid(), c.clinic_id, 'APPOINTMENT_CONFIRMATION', 'EN', E'Hello {patient_name},\n\nYour appointment with {doctor_name} at {clinic_name} is booked.\nDate: {appointment_date}\nTime: {appointment_time}\n\nPlease contact the clinic if you are unable to attend.', TRUE, 1, u.user_id "
            "FROM clinics c JOIN LATERAL ("
            "SELECT user_id FROM users WHERE clinic_id = c.clinic_id ORDER BY created_at LIMIT 1"
            ") u ON TRUE ON CONFLICT (clinic_id, template_type, language) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO message_templates (template_id, clinic_id, template_type, language, template_body, active, version, updated_by) "
            "SELECT gen_random_uuid(), c.clinic_id, 'APPOINTMENT_CONFIRMATION', 'HI', E'नमस्ते {patient_name},\n\n{clinic_name} में {doctor_name} के साथ आपका अपॉइंटमेंट बुक हो गया है।\nदिनांक: {appointment_date}\nसमय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया क्लिनिक से संपर्क करें।', TRUE, 1, u.user_id "
            "FROM clinics c JOIN LATERAL ("
            "SELECT user_id FROM users WHERE clinic_id = c.clinic_id ORDER BY created_at LIMIT 1"
            ") u ON TRUE ON CONFLICT (clinic_id, template_type, language) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO message_templates (template_id, clinic_id, template_type, language, template_body, active, version, updated_by) "
            "SELECT gen_random_uuid(), c.clinic_id, 'APPOINTMENT_REMINDER', 'EN', E'Hello {patient_name},\n\nThis is a reminder for your appointment with {doctor_name}.\nDate: {appointment_date}\nTime: {appointment_time}\n\nPlease contact {clinic_name} if you are unable to attend.', TRUE, 1, u.user_id "
            "FROM clinics c JOIN LATERAL ("
            "SELECT user_id FROM users WHERE clinic_id = c.clinic_id ORDER BY created_at LIMIT 1"
            ") u ON TRUE ON CONFLICT (clinic_id, template_type, language) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO message_templates (template_id, clinic_id, template_type, language, template_body, active, version, updated_by) "
            "SELECT gen_random_uuid(), c.clinic_id, 'APPOINTMENT_REMINDER', 'HI', E'नमस्ते {patient_name},\n\nयह {doctor_name} के साथ आपके अपॉइंटमेंट की याद दिलाने वाला संदेश है।\nदिनांक: {appointment_date}\nसमय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया {clinic_name} से संपर्क करें।', TRUE, 1, u.user_id "
            "FROM clinics c JOIN LATERAL ("
            "SELECT user_id FROM users WHERE clinic_id = c.clinic_id ORDER BY created_at LIMIT 1"
            ") u ON TRUE ON CONFLICT (clinic_id, template_type, language) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO message_templates (template_id, clinic_id, template_type, language, template_body, active, version, updated_by) "
            "SELECT gen_random_uuid(), c.clinic_id, 'APPOINTMENT_CANCELLED', 'EN', E'Hello {patient_name},\n\nYour appointment with {doctor_name} on {appointment_date} at {appointment_time} has been cancelled.\nPlease contact {clinic_name} if you need another appointment.', TRUE, 1, u.user_id "
            "FROM clinics c JOIN LATERAL ("
            "SELECT user_id FROM users WHERE clinic_id = c.clinic_id ORDER BY created_at LIMIT 1"
            ") u ON TRUE ON CONFLICT (clinic_id, template_type, language) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO message_templates (template_id, clinic_id, template_type, language, template_body, active, version, updated_by) "
            "SELECT gen_random_uuid(), c.clinic_id, 'APPOINTMENT_CANCELLED', 'HI', E'नमस्ते {patient_name},\n\n{doctor_name} के साथ {appointment_date} को {appointment_time} वाला आपका अपॉइंटमेंट रद्द कर दिया गया है।\nनया अपॉइंटमेंट चाहिए तो कृपया {clinic_name} से संपर्क करें।', TRUE, 1, u.user_id "
            "FROM clinics c JOIN LATERAL ("
            "SELECT user_id FROM users WHERE clinic_id = c.clinic_id ORDER BY created_at LIMIT 1"
            ") u ON TRUE ON CONFLICT (clinic_id, template_type, language) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO message_templates (template_id, clinic_id, template_type, language, template_body, active, version, updated_by) "
            "SELECT gen_random_uuid(), c.clinic_id, 'APPOINTMENT_RESCHEDULED', 'EN', E'Hello {patient_name},\n\nYour appointment with {doctor_name} has been rescheduled.\nNew date: {appointment_date}\nNew time: {appointment_time}\n\nPlease contact {clinic_name} if you are unable to attend.', TRUE, 1, u.user_id "
            "FROM clinics c JOIN LATERAL ("
            "SELECT user_id FROM users WHERE clinic_id = c.clinic_id ORDER BY created_at LIMIT 1"
            ") u ON TRUE ON CONFLICT (clinic_id, template_type, language) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO message_templates (template_id, clinic_id, template_type, language, template_body, active, version, updated_by) "
            "SELECT gen_random_uuid(), c.clinic_id, 'APPOINTMENT_RESCHEDULED', 'HI', E'नमस्ते {patient_name},\n\n{doctor_name} के साथ आपका अपॉइंटमेंट बदल दिया गया है।\nनई तारीख: {appointment_date}\nनया समय: {appointment_time}\n\nयदि आप नहीं आ पाएंगे, तो कृपया {clinic_name} से संपर्क करें।', TRUE, 1, u.user_id "
            "FROM clinics c JOIN LATERAL ("
            "SELECT user_id FROM users WHERE clinic_id = c.clinic_id ORDER BY created_at LIMIT 1"
            ") u ON TRUE ON CONFLICT (clinic_id, template_type, language) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO message_templates (template_id, clinic_id, template_type, language, template_body, active, version, updated_by) "
            "SELECT gen_random_uuid(), c.clinic_id, 'FOLLOWUP_REMINDER', 'EN', E'Hello {patient_name},\n\nThis is a reminder that your follow-up with {doctor_name} is due around {followup_due_date}.\nPlease contact {clinic_name} to book an appointment.', TRUE, 1, u.user_id "
            "FROM clinics c JOIN LATERAL ("
            "SELECT user_id FROM users WHERE clinic_id = c.clinic_id ORDER BY created_at LIMIT 1"
            ") u ON TRUE ON CONFLICT (clinic_id, template_type, language) DO NOTHING"
        )
    )
    op.execute(
        sa.text(
            "INSERT INTO message_templates (template_id, clinic_id, template_type, language, template_body, active, version, updated_by) "
            "SELECT gen_random_uuid(), c.clinic_id, 'FOLLOWUP_REMINDER', 'HI', E'नमस्ते {patient_name},\n\n{doctor_name} के साथ आपका फॉलो-अप लगभग {followup_due_date} को निर्धारित है।\nअपॉइंटमेंट बुक करने के लिए कृपया {clinic_name} से संपर्क करें।', TRUE, 1, u.user_id "
            "FROM clinics c JOIN LATERAL ("
            "SELECT user_id FROM users WHERE clinic_id = c.clinic_id ORDER BY created_at LIMIT 1"
            ") u ON TRUE ON CONFLICT (clinic_id, template_type, language) DO NOTHING"
        )
    )


def downgrade() -> None:
    op.drop_table("reminders")
    op.drop_table("message_templates")
