from datetime import date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'VOID')",
            name="status_allowed",
        ),
        CheckConstraint(
            "payment_method IS NULL OR payment_method IN ('CASH', 'UPI')",
            name="payment_method_allowed",
        ),
        CheckConstraint(
            "confirmation_source IS NULL OR confirmation_source IN ('ASSISTANT', 'PROVIDER_API')",
            name="confirmation_source_allowed",
        ),
        CheckConstraint("amount_due >= 0", name="amount_due_nonnegative"),
        CheckConstraint("amount_paid IS NULL OR amount_paid >= 0", name="amount_paid_nonnegative"),
        CheckConstraint(
            "(status = 'PENDING' AND amount_paid IS NULL AND payment_method IS NULL "
            "AND confirmation_source IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL "
            "AND cancelled_by IS NULL AND cancelled_at IS NULL AND voided_by IS NULL AND voided_at IS NULL) "
            "OR (status = 'CONFIRMED' AND amount_paid = amount_due AND payment_method IS NOT NULL "
            "AND confirmation_source IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL "
            "AND cancelled_by IS NULL AND cancelled_at IS NULL AND voided_by IS NULL AND voided_at IS NULL) "
            "OR (status = 'CANCELLED' AND amount_paid IS NULL AND payment_method IS NULL "
            "AND confirmed_by IS NULL AND confirmed_at IS NULL AND cancelled_by IS NOT NULL "
            "AND cancelled_at IS NOT NULL AND voided_by IS NULL AND voided_at IS NULL) "
            "OR (status = 'VOID' AND amount_paid = amount_due AND payment_method IS NOT NULL "
            "AND confirmation_source IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL "
            "AND voided_by IS NOT NULL AND voided_at IS NOT NULL)",
            name="state_shape_valid",
        ),
        Index("ix_payments_clinic_status", "clinic_id", "status"),
        Index("ix_payments_patient_created", "patient_id", "created_at"),
        Index("ix_payments_confirmed_at", "confirmed_at"),
        Index(
            "uq_payments_visit_current_settlement",
            "visit_id",
            unique=True,
            postgresql_where=text("status IN ('PENDING', 'CONFIRMED')"),
        ),
    )

    payment_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    visit_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("visits.visit_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    patient_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("patients.patient_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    amount_due: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    amount_paid: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")
    confirmation_source: Mapped[str | None] = mapped_column(String(30), nullable=True)
    confirmed_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    voided_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    void_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    correction_of_payment_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("payments.payment_id", ondelete="RESTRICT"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Receipt(Base):
    __tablename__ = "receipts"
    __table_args__ = (
        UniqueConstraint("payment_id", name="uq_receipts_payment_id"),
        UniqueConstraint("clinic_id", "receipt_number", name="uq_receipts_clinic_number"),
        CheckConstraint("amount_snapshot >= 0", name="amount_snapshot_nonnegative"),
        CheckConstraint(
            "payment_method_snapshot IN ('CASH', 'UPI')",
            name="payment_method_snapshot_allowed",
        ),
        Index("ix_receipts_clinic_issued", "clinic_id", "issued_at"),
    )

    receipt_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    payment_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("payments.payment_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    receipt_number: Mapped[str] = mapped_column(String(40), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    clinic_name_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    doctor_name_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    patient_name_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    appointment_type_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    visit_date_snapshot: Mapped[date] = mapped_column(Date, nullable=False)
    amount_snapshot: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    payment_method_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)


class UpiConfiguration(Base):
    __tablename__ = "upi_configurations"
    __table_args__ = (
        UniqueConstraint("clinic_id", name="uq_upi_configurations_clinic_id"),
        CheckConstraint("version > 0", name="version_positive"),
    )

    upi_configuration_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    upi_id: Mapped[str] = mapped_column(String(120), nullable=False)
    payee_name: Mapped[str] = mapped_column(String(160), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_by: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
