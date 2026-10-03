"""M6 payments, receipts and UPI configuration.

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_payments_confirmed_at", "payments", ["confirmed_at"])

    # Align the persisted constraint with the final M6 payment-state shape.
    op.drop_constraint("ck_payments_state_shape_valid", "payments", type_="check")
    op.create_check_constraint(
        "ck_payments_state_shape_valid",
        "payments",
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
    )

    op.create_table(
        "receipts",
        sa.Column("receipt_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("payment_id", sa.Uuid(), sa.ForeignKey("payments.payment_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("receipt_number", sa.String(40), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("clinic_name_snapshot", sa.String(160), nullable=False),
        sa.Column("doctor_name_snapshot", sa.String(160), nullable=False),
        sa.Column("patient_name_snapshot", sa.String(160), nullable=False),
        sa.Column("appointment_type_snapshot", sa.String(20), nullable=False),
        sa.Column("visit_date_snapshot", sa.Date(), nullable=False),
        sa.Column("amount_snapshot", sa.Numeric(12, 2), nullable=False),
        sa.Column("payment_method_snapshot", sa.String(20), nullable=False),
        sa.CheckConstraint("amount_snapshot >= 0", name="ck_receipts_amount_snapshot_nonnegative"),
        sa.CheckConstraint(
            "payment_method_snapshot IN ('CASH', 'UPI')",
            name="ck_receipts_payment_method_snapshot_allowed",
        ),
        sa.UniqueConstraint("payment_id", name="uq_receipts_payment_id"),
        sa.UniqueConstraint("clinic_id", "receipt_number", name="uq_receipts_clinic_number"),
    )
    op.create_index("ix_receipts_clinic_id", "receipts", ["clinic_id"])
    op.create_index("ix_receipts_payment_id", "receipts", ["payment_id"])
    op.create_index("ix_receipts_clinic_issued", "receipts", ["clinic_id", "issued_at"])

    op.create_table(
        "upi_configurations",
        sa.Column("upi_configuration_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("upi_id", sa.String(120), nullable=False),
        sa.Column("payee_name", sa.String(160), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("version > 0", name="ck_upi_configurations_version_positive"),
        sa.UniqueConstraint("clinic_id", name="uq_upi_configurations_clinic_id"),
    )
    op.create_index("ix_upi_configurations_clinic_id", "upi_configurations", ["clinic_id"])


def downgrade() -> None:
    op.drop_table("upi_configurations")
    op.drop_table("receipts")
    op.drop_constraint("ck_payments_state_shape_valid", "payments", type_="check")
    op.create_check_constraint(
        "ck_payments_state_shape_valid",
        "payments",
        "(status = 'PENDING' AND amount_paid IS NULL AND payment_method IS NULL AND confirmation_source IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL AND cancelled_by IS NULL AND cancelled_at IS NULL AND voided_by IS NULL AND voided_at IS NULL) "
        "OR (status = 'CONFIRMED' AND amount_paid = amount_due AND payment_method IS NOT NULL AND confirmation_source IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND cancelled_by IS NULL AND cancelled_at IS NULL AND voided_by IS NULL AND voided_at IS NULL) "
        "OR (status = 'CANCELLED' AND amount_paid IS NULL AND payment_method IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND voided_by IS NULL AND voided_at IS NULL) "
        "OR (status = 'VOID' AND amount_paid = amount_due AND payment_method IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND voided_by IS NOT NULL AND voided_at IS NOT NULL)",
    )
    op.drop_index("ix_payments_confirmed_at", table_name="payments")
