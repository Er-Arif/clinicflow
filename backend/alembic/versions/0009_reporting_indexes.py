"""M9 reporting query indexes.

Revision ID: 0009
Revises: 0008
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Read-model indexes only. Reports remain derived from transactional facts.
    op.create_index(
        "ix_session_occurrences_clinic_date",
        "session_occurrences",
        ["clinic_id", "occurrence_date"],
    )
    op.create_index(
        "ix_visits_clinic_completed_at",
        "visits",
        ["clinic_id", "completed_at"],
        postgresql_where="status = 'COMPLETED'",
    )
    op.create_index(
        "ix_payments_clinic_confirmed_at_confirmed",
        "payments",
        ["clinic_id", "confirmed_at"],
        postgresql_where="status = 'CONFIRMED'",
    )
    op.create_index(
        "ix_payments_clinic_voided_at_void",
        "payments",
        ["clinic_id", "voided_at"],
        postgresql_where="status = 'VOID'",
    )
    op.create_index(
        "ix_audit_events_clinic_action_occurred",
        "audit_events",
        ["clinic_id", "action_type", "occurred_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_events_clinic_action_occurred", table_name="audit_events")
    op.drop_index("ix_payments_clinic_voided_at_void", table_name="payments")
    op.drop_index("ix_payments_clinic_confirmed_at_confirmed", table_name="payments")
    op.drop_index("ix_visits_clinic_completed_at", table_name="visits")
    op.drop_index("ix_session_occurrences_clinic_date", table_name="session_occurrences")
