"""add trigram index for patient name search

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-25
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0015"
down_revision: str | Sequence[str] | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_INDEX_NAME = "ix_patients_full_name_trgm"


def upgrade() -> None:
    # pg_trgm is a trusted PostgreSQL extension and is supported by the
    # production PostgreSQL profiles used by ClinicFlow.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        _INDEX_NAME,
        "patients",
        ["full_name"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"full_name": "gin_trgm_ops"},
    )


def downgrade() -> None:
    op.drop_index(_INDEX_NAME, table_name="patients")
    # Do not DROP EXTENSION pg_trgm: another schema object may legitimately
    # share it after this migration has been applied.
