from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Time,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ScheduleDefinition(Base):
    __tablename__ = "schedule_definitions"
    __table_args__ = (
        UniqueConstraint(
            "doctor_id", "weekday", "effective_from", name="uq_schedule_doctor_weekday_from"
        ),
        CheckConstraint("weekday >= 0 AND weekday <= 6", name="weekday_range"),
        CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from", name="effective_date_order"
        ),
    )

    schedule_definition_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    doctor_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("doctors.doctor_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    weekday: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SessionDefinition(Base):
    __tablename__ = "session_definitions"
    __table_args__ = (
        UniqueConstraint(
            "schedule_definition_id", "display_order", name="uq_session_schedule_display_order"
        ),
        CheckConstraint("end_time > start_time", name="time_order"),
        CheckConstraint("slot_interval_minutes > 0", name="slot_interval_positive"),
        CheckConstraint("maximum_capacity > 0", name="maximum_capacity_positive"),
    )

    session_definition_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    schedule_definition_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("schedule_definitions.schedule_definition_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    session_name: Mapped[str] = mapped_column(String(80), nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    slot_interval_minutes: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    maximum_capacity: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    display_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SessionOccurrence(Base):
    __tablename__ = "session_occurrences"
    __table_args__ = (
        UniqueConstraint(
            "session_definition_id", "occurrence_date", name="uq_occurrence_session_date"
        ),
        CheckConstraint("status IN ('AVAILABLE', 'BLOCKED')", name="status_allowed"),
        CheckConstraint("end_time_snapshot > start_time_snapshot", name="snapshot_time_order"),
        CheckConstraint("slot_interval_minutes_snapshot > 0", name="snapshot_interval_positive"),
        CheckConstraint("maximum_capacity_snapshot > 0", name="snapshot_capacity_positive"),
    )

    session_occurrence_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    doctor_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("doctors.doctor_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    session_definition_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("session_definitions.session_definition_id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    occurrence_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    session_name_snapshot: Mapped[str] = mapped_column(String(80), nullable=False)
    start_time_snapshot: Mapped[time] = mapped_column(Time, nullable=False)
    end_time_snapshot: Mapped[time] = mapped_column(Time, nullable=False)
    slot_interval_minutes_snapshot: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    maximum_capacity_snapshot: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="AVAILABLE")
    block_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    blocked_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class FeeConfiguration(Base):
    __tablename__ = "fee_configurations"
    __table_args__ = (
        UniqueConstraint("clinic_id", "effective_from", name="uq_fee_clinic_effective_from"),
        CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from", name="effective_date_order"
        ),
        CheckConstraint("regular_fee >= 0", name="regular_fee_nonnegative"),
        CheckConstraint("followup_fee >= 0", name="followup_fee_nonnegative"),
    )

    fee_configuration_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    regular_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    followup_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    assistant_adjustment_allowed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
