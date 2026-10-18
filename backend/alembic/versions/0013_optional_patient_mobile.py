"""Allow patient registration without a mobile number.

Revision ID: 0013
Revises: 0012
"""

import sqlalchemy as sa

from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("whatsapp_contact_consistency", "patients", type_="check")
    op.alter_column(
        "patients",
        "mobile_e164",
        existing_type=sa.String(length=16),
        nullable=True,
    )
    op.create_check_constraint(
        "whatsapp_contact_consistency",
        "patients",
        "whatsapp_same_as_mobile = FALSE OR "
        "(mobile_e164 IS NOT NULL AND whatsapp_e164 = mobile_e164)",
    )


def downgrade() -> None:
    bind = op.get_bind()
    incompatible_rows = bind.scalar(
        sa.text(
            """
            SELECT COUNT(*)
            FROM patients
            WHERE mobile_e164 IS NULL
               OR (whatsapp_same_as_mobile = FALSE AND whatsapp_e164 IS NULL)
            """
        )
    )
    if incompatible_rows:
        raise RuntimeError(
            "Cannot downgrade 0013 while patients without the legacy required contacts exist."
        )

    op.drop_constraint("whatsapp_contact_consistency", "patients", type_="check")
    op.alter_column(
        "patients",
        "mobile_e164",
        existing_type=sa.String(length=16),
        nullable=False,
    )
    op.create_check_constraint(
        "whatsapp_contact_consistency",
        "patients",
        "(whatsapp_same_as_mobile = TRUE AND whatsapp_e164 = mobile_e164) "
        "OR (whatsapp_same_as_mobile = FALSE AND whatsapp_e164 IS NOT NULL)",
    )
