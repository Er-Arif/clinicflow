"""admin settings and user concurrency

Revision ID: 0010
Revises: 0009
"""

from alembic import op
import sqlalchemy as sa

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index(
        "ix_users_clinic_active_display",
        "users",
        ["clinic_id", "active", "display_name"],
    )


def downgrade() -> None:
    op.drop_index("ix_users_clinic_active_display", table_name="users")
    op.drop_column("users", "version")
