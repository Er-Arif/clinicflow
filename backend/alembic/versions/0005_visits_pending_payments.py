"""visits and pending payment obligations

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "visits",
        sa.Column("visit_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), sa.ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("patient_id", sa.Uuid(), sa.ForeignKey("patients.patient_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("doctor_id", sa.Uuid(), sa.ForeignKey("doctors.doctor_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("visit_type", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="ACTIVE"),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("aborted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("visit_type IN ('REGULAR', 'FOLLOW_UP')", name="ck_visits_visit_type_allowed"),
        sa.CheckConstraint("status IN ('ACTIVE', 'COMPLETED', 'ABORTED')", name="ck_visits_status_allowed"),
        sa.CheckConstraint(
            "(status = 'ACTIVE' AND completed_at IS NULL AND aborted_at IS NULL) "
            "OR (status = 'COMPLETED' AND completed_at IS NOT NULL AND aborted_at IS NULL) "
            "OR (status = 'ABORTED' AND aborted_at IS NOT NULL AND completed_at IS NULL)",
            name="ck_visits_state_timestamps_valid",
        ),
        sa.UniqueConstraint("appointment_id", name="uq_visits_appointment_id"),
    )
    op.create_index("ix_visits_clinic_id", "visits", ["clinic_id"])
    op.create_index("ix_visits_appointment_id", "visits", ["appointment_id"])
    op.create_index("ix_visits_patient_id", "visits", ["patient_id"])
    op.create_index("ix_visits_doctor_id", "visits", ["doctor_id"])
    op.create_index("ix_visits_clinic_status", "visits", ["clinic_id", "status"])
    op.create_index("ix_visits_patient_checked_in", "visits", ["patient_id", "checked_in_at"])

    op.create_table(
        "payments",
        sa.Column("payment_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("visit_id", sa.Uuid(), sa.ForeignKey("visits.visit_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("patient_id", sa.Uuid(), sa.ForeignKey("patients.patient_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount_due", sa.Numeric(12, 2), nullable=False),
        sa.Column("amount_paid", sa.Numeric(12, 2), nullable=True),
        sa.Column("payment_method", sa.String(20), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("confirmation_source", sa.String(30), nullable=True),
        sa.Column("confirmed_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_reason", sa.String(500), nullable=True),
        sa.Column("voided_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("void_reason", sa.String(500), nullable=True),
        sa.Column("correction_of_payment_id", sa.Uuid(), sa.ForeignKey("payments.payment_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'VOID')", name="ck_payments_status_allowed"),
        sa.CheckConstraint("payment_method IS NULL OR payment_method IN ('CASH', 'UPI')", name="ck_payments_payment_method_allowed"),
        sa.CheckConstraint("confirmation_source IS NULL OR confirmation_source IN ('ASSISTANT', 'PROVIDER_API')", name="ck_payments_confirmation_source_allowed"),
        sa.CheckConstraint("amount_due >= 0", name="ck_payments_amount_due_nonnegative"),
        sa.CheckConstraint("amount_paid IS NULL OR amount_paid >= 0", name="ck_payments_amount_paid_nonnegative"),
        sa.CheckConstraint(
            "(status = 'PENDING' AND amount_paid IS NULL AND payment_method IS NULL AND confirmation_source IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL AND cancelled_by IS NULL AND cancelled_at IS NULL AND voided_by IS NULL AND voided_at IS NULL) "
            "OR (status = 'CONFIRMED' AND amount_paid = amount_due AND payment_method IS NOT NULL AND confirmation_source IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND cancelled_by IS NULL AND cancelled_at IS NULL AND voided_by IS NULL AND voided_at IS NULL) "
            "OR (status = 'CANCELLED' AND amount_paid IS NULL AND payment_method IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND voided_by IS NULL AND voided_at IS NULL) "
            "OR (status = 'VOID' AND amount_paid = amount_due AND payment_method IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND voided_by IS NOT NULL AND voided_at IS NOT NULL)",
            name="ck_payments_state_shape_valid",
        ),
    )
    op.create_index("ix_payments_clinic_id", "payments", ["clinic_id"])
    op.create_index("ix_payments_visit_id", "payments", ["visit_id"])
    op.create_index("ix_payments_patient_id", "payments", ["patient_id"])
    op.create_index("ix_payments_clinic_status", "payments", ["clinic_id", "status"])
    op.create_index("ix_payments_patient_created", "payments", ["patient_id", "created_at"])
    op.create_index(
        "uq_payments_visit_current_settlement",
        "payments",
        ["visit_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('PENDING', 'CONFIRMED')"),
    )


def downgrade() -> None:
    op.drop_table("payments")
    op.drop_table("visits")
