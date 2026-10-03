"""patient management foundation

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "number_counters",
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("counter_key", sa.String(64), nullable=False),
        sa.Column("last_value", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("clinic_id", "counter_key", name="pk_number_counters"),
    )

    op.create_table(
        "patients",
        sa.Column("patient_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("patient_code", sa.String(32), nullable=False),
        sa.Column("full_name", sa.String(160), nullable=False),
        sa.Column("mobile_e164", sa.String(16), nullable=False),
        sa.Column("whatsapp_e164", sa.String(16), nullable=True),
        sa.Column("whatsapp_same_as_mobile", sa.Boolean(), nullable=False),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column("approximate_age_years", sa.SmallInteger(), nullable=True),
        sa.Column("age_as_of_date", sa.Date(), nullable=True),
        sa.Column("gender", sa.String(24), nullable=False),
        sa.Column("preferred_language", sa.String(2), nullable=False),
        sa.Column("reminders_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("clinic_id", "patient_code", name="uq_patients_clinic_patient_code"),
        sa.CheckConstraint("gender IN ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY')", name="gender_allowed"),
        sa.CheckConstraint("preferred_language IN ('EN', 'HI')", name="preferred_language_allowed"),
        sa.CheckConstraint(
            "approximate_age_years IS NULL OR (approximate_age_years >= 0 AND approximate_age_years <= 130)",
            name="approximate_age_range",
        ),
        sa.CheckConstraint(
            "(date_of_birth IS NOT NULL AND approximate_age_years IS NULL AND age_as_of_date IS NULL) "
            "OR (date_of_birth IS NULL AND approximate_age_years IS NOT NULL AND age_as_of_date IS NOT NULL)",
            name="dob_or_approximate_age",
        ),
        sa.CheckConstraint(
            "(whatsapp_same_as_mobile = TRUE AND whatsapp_e164 = mobile_e164) "
            "OR (whatsapp_same_as_mobile = FALSE AND whatsapp_e164 IS NOT NULL)",
            name="whatsapp_contact_consistency",
        ),
    )
    op.create_index("ix_patients_clinic_id", "patients", ["clinic_id"])
    op.create_index("ix_patients_mobile_e164", "patients", ["mobile_e164"])
    op.create_index("ix_patients_clinic_mobile_e164", "patients", ["clinic_id", "mobile_e164"])
    op.create_index("ix_patients_clinic_patient_code", "patients", ["clinic_id", "patient_code"])


def downgrade() -> None:
    op.drop_table("patients")
    op.drop_table("number_counters")
