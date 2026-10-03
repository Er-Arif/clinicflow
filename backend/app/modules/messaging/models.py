from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class MessageTemplate(Base):
    __tablename__ = "message_templates"
    __table_args__ = (
        CheckConstraint("language IN ('EN', 'HI')", name="language_allowed"),
        CheckConstraint(
            "template_type IN ('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_RESCHEDULED', 'FOLLOWUP_REMINDER')",
            name="template_type_allowed",
        ),
        UniqueConstraint("clinic_id", "template_type", "language", name="uq_message_templates_clinic_type_language"),
    )

    template_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    template_type: Mapped[str] = mapped_column(String(40), nullable=False)
    language: Mapped[str] = mapped_column(String(2), nullable=False)
    template_body: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Reminder(Base):
    __tablename__ = "reminders"
    __table_args__ = (
        CheckConstraint(
            "reminder_type IN ('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_RESCHEDULED', 'FOLLOWUP_REMINDER')",
            name="reminder_type_allowed",
        ),
        CheckConstraint("channel IN ('WHATSAPP_APP')", name="channel_allowed"),
        CheckConstraint("language IN ('EN', 'HI')", name="language_allowed"),
        CheckConstraint("status IN ('DUE', 'SENT', 'SKIPPED')", name="status_allowed"),
        CheckConstraint(
            "(appointment_id IS NOT NULL AND followup_id IS NULL) OR (appointment_id IS NULL AND followup_id IS NOT NULL)",
            name="exactly_one_reference",
        ),
        CheckConstraint(
            "(status = 'DUE' AND sent_by IS NULL AND sent_at IS NULL AND skipped_at IS NULL) "
            "OR (status = 'SENT' AND sent_by IS NOT NULL AND sent_at IS NOT NULL AND skipped_at IS NULL) "
            "OR (status = 'SKIPPED' AND sent_by IS NULL AND sent_at IS NULL AND skipped_at IS NOT NULL)",
            name="state_shape_valid",
        ),
        Index("ix_reminders_clinic_status_due", "clinic_id", "status", "due_on"),
        Index(
            "uq_reminders_appointment_type",
            "appointment_id",
            "reminder_type",
            unique=True,
            postgresql_where=text("appointment_id IS NOT NULL"),
        ),
        Index(
            "uq_reminders_followup_type",
            "followup_id",
            "reminder_type",
            unique=True,
            postgresql_where=text("followup_id IS NOT NULL"),
        ),
    )

    reminder_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    patient_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("patients.patient_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    appointment_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=True, index=True
    )
    followup_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("followup_recommendations.followup_id", ondelete="RESTRICT"), nullable=True, index=True
    )
    reminder_type: Mapped[str] = mapped_column(String(40), nullable=False)
    channel: Mapped[str] = mapped_column(String(30), nullable=False, default="WHATSAPP_APP")
    language: Mapped[str] = mapped_column(String(2), nullable=False)
    due_on: Mapped[date] = mapped_column(Date, nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DUE")
    message_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    skipped_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    skipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    skip_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
