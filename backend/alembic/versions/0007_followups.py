"""M7 follow-up recommendations.

Revision ID: 0007
Revises: 0006
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "followup_recommendations",
        sa.Column("followup_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("patient_id", sa.Uuid(), sa.ForeignKey("patients.patient_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("source_visit_id", sa.Uuid(), sa.ForeignKey("visits.visit_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("interval_days", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="OPEN"),
        sa.Column("linked_appointment_id", sa.Uuid(), sa.ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("closed_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("close_reason", sa.String(500), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("status IN ('OPEN', 'BOOKED', 'CLOSED')", name="ck_followup_recommendations_status_allowed"),
        sa.CheckConstraint("interval_days IS NULL OR interval_days > 0", name="ck_followup_recommendations_interval_days_positive"),
        sa.CheckConstraint(
            "(status = 'OPEN' AND linked_appointment_id IS NULL AND closed_by IS NULL AND closed_at IS NULL) "
            "OR (status = 'BOOKED' AND linked_appointment_id IS NOT NULL AND closed_by IS NULL AND closed_at IS NULL) "
            "OR (status = 'CLOSED' AND closed_by IS NOT NULL AND closed_at IS NOT NULL)",
            name="ck_followup_recommendations_state_shape_valid",
        ),
        sa.UniqueConstraint("source_visit_id", name="uq_followups_source_visit"),
        sa.UniqueConstraint("linked_appointment_id", name="uq_followups_linked_appointment"),
    )
    op.create_index("ix_followup_recommendations_clinic_id", "followup_recommendations", ["clinic_id"])
    op.create_index("ix_followup_recommendations_patient_id", "followup_recommendations", ["patient_id"])
    op.create_index("ix_followup_recommendations_source_visit_id", "followup_recommendations", ["source_visit_id"])
    op.create_index("ix_followup_recommendations_linked_appointment_id", "followup_recommendations", ["linked_appointment_id"])
    op.create_index("ix_followups_clinic_status_due", "followup_recommendations", ["clinic_id", "status", "due_date"])
    op.create_index("ix_followups_patient_due", "followup_recommendations", ["patient_id", "due_date"])


def downgrade() -> None:
    op.drop_table("followup_recommendations")
