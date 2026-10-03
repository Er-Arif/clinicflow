from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Visit(Base):
    __tablename__ = "visits"
    __table_args__ = (
        CheckConstraint("visit_type IN ('REGULAR', 'FOLLOW_UP')", name="visit_type_allowed"),
        CheckConstraint("status IN ('ACTIVE', 'COMPLETED', 'ABORTED')", name="status_allowed"),
        CheckConstraint(
            "(status = 'ACTIVE' AND completed_at IS NULL AND aborted_at IS NULL) "
            "OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND aborted_at IS NULL) "
            "OR (status = 'ABORTED' AND aborted_at IS NOT NULL AND completed_at IS NULL)",
            name="state_timestamps_valid",
        ),
        Index("ix_visits_clinic_status", "clinic_id", "status"),
        Index("ix_visits_patient_checked_in", "patient_id", "checked_in_at"),
    )

    visit_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    appointment_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("appointments.appointment_id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
        index=True,
    )
    patient_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("patients.patient_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    doctor_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("doctors.doctor_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    visit_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")
    checked_in_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    aborted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
