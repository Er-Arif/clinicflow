from datetime import datetime, time
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Time,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        CheckConstraint(
            "appointment_type IN ('REGULAR', 'FOLLOW_UP')",
            name="appointment_type_allowed",
        ),
        CheckConstraint(
            "booking_source IN ('ASSISTANT', 'ADMIN', 'WALK_IN', 'WHATSAPP', 'WEB', 'PATIENT_APP')",
            name="booking_source_allowed",
        ),
        CheckConstraint(
            "status IN ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED')",
            name="status_allowed",
        ),
        CheckConstraint(
            "cancellation_reason IS NULL OR cancellation_reason IN "
            "('PATIENT_CANCELLED', 'NO_SHOW', 'DOCTOR_UNAVAILABLE', 'OTHER', 'RESCHEDULED')",
            name="cancellation_reason_allowed",
        ),
        CheckConstraint("base_fee_snapshot >= 0", name="base_fee_nonnegative"),
        CheckConstraint("effective_fee_amount >= 0", name="effective_fee_nonnegative"),
        CheckConstraint(
            "capacity_override_used OR "
            "(capacity_override_by IS NULL AND capacity_override_at IS NULL "
            "AND capacity_override_reason IS NULL AND override_capacity_snapshot IS NULL "
            "AND override_existing_count IS NULL)",
            name="override_metadata_requires_flag",
        ),
        Index("ix_appointments_clinic_created", "clinic_id", "created_at"),
        Index("ix_appointments_patient_created", "patient_id", "created_at"),
        Index("ix_appointments_doctor_status", "doctor_id", "status"),
        Index("ix_appointments_occurrence_status", "session_occurrence_id", "status"),
    )

    appointment_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    patient_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("patients.patient_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    doctor_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("doctors.doctor_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    session_occurrence_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("session_occurrences.session_occurrence_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    appointment_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    appointment_type: Mapped[str] = mapped_column(String(20), nullable=False)
    booking_source: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="BOOKED")
    base_fee_snapshot: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    effective_fee_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    fee_adjustment_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    fee_adjusted_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    fee_adjusted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    cancellation_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)
    cancellation_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    rescheduled_from_appointment_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=True
    )
    rescheduled_to_appointment_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=True
    )
    capacity_override_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    capacity_override_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    capacity_override_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    capacity_override_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    override_capacity_snapshot: Mapped[int | None] = mapped_column(Integer, nullable=True)
    override_existing_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class AppointmentFeeAdjustment(Base):
    __tablename__ = "appointment_fee_adjustments"
    __table_args__ = (
        CheckConstraint("previous_amount >= 0", name="previous_amount_nonnegative"),
        CheckConstraint("new_amount >= 0", name="new_amount_nonnegative"),
    )

    fee_adjustment_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    appointment_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    previous_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    new_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    adjusted_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False
    )
    adjusted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
