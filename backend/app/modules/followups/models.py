from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FollowUpRecommendation(Base):
    __tablename__ = "followup_recommendations"
    __table_args__ = (
        CheckConstraint("status IN ('OPEN', 'BOOKED', 'CLOSED')", name="status_allowed"),
        CheckConstraint("interval_days IS NULL OR interval_days > 0", name="interval_days_positive"),
        CheckConstraint(
            "(status = 'OPEN' AND linked_appointment_id IS NULL AND closed_by IS NULL AND closed_at IS NULL) "
            "OR (status = 'BOOKED' AND linked_appointment_id IS NOT NULL AND closed_by IS NULL AND closed_at IS NULL) "
            "OR (status = 'CLOSED' AND closed_by IS NOT NULL AND closed_at IS NOT NULL)",
            name="state_shape_valid",
        ),
        UniqueConstraint("source_visit_id", name="uq_followups_source_visit"),
        UniqueConstraint("linked_appointment_id", name="uq_followups_linked_appointment"),
        Index("ix_followups_clinic_status_due", "clinic_id", "status", "due_date"),
        Index("ix_followups_patient_due", "patient_id", "due_date"),
    )

    followup_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    patient_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("patients.patient_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    source_visit_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("visits.visit_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    interval_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="OPEN")
    linked_appointment_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=True, index=True
    )
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    closed_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    close_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
