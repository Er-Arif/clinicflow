"""scheduling, session occurrences and fees

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-03
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        "schedule_definitions",
        sa.Column("schedule_definition_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "clinic_id",
            sa.Uuid(),
            sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "doctor_id",
            sa.Uuid(),
            sa.ForeignKey("doctors.doctor_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.user_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "doctor_id", "weekday", "effective_from", name="uq_schedule_doctor_weekday_from"
        ),
        sa.CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_schedule_definitions_weekday_range"),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from",
            name="ck_schedule_definitions_effective_date_order",
        ),
    )
    op.create_index("ix_schedule_definitions_clinic_id", "schedule_definitions", ["clinic_id"])
    op.create_index("ix_schedule_definitions_doctor_id", "schedule_definitions", ["doctor_id"])
    op.create_index(
        "ix_schedule_definitions_lookup",
        "schedule_definitions",
        ["clinic_id", "doctor_id", "weekday", "effective_from"],
    )
    # effective_to is inclusive in ClinicFlow. Add one day to turn it into a half-open daterange.
    op.execute(
        """
        ALTER TABLE schedule_definitions
        ADD CONSTRAINT ex_schedule_definition_effective_period
        EXCLUDE USING gist (
          doctor_id WITH =,
          weekday WITH =,
          daterange(
            effective_from,
            CASE WHEN effective_to IS NULL THEN 'infinity'::date ELSE effective_to + 1 END,
            '[)'
          ) WITH &&
        )
        WHERE (active = TRUE)
        """
    )

    op.create_table(
        "session_definitions",
        sa.Column("session_definition_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "clinic_id",
            sa.Uuid(),
            sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "schedule_definition_id",
            sa.Uuid(),
            sa.ForeignKey("schedule_definitions.schedule_definition_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("session_name", sa.String(80), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("slot_interval_minutes", sa.SmallInteger(), nullable=False),
        sa.Column("maximum_capacity", sa.SmallInteger(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("display_order", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "schedule_definition_id", "display_order", name="uq_session_schedule_display_order"
        ),
        sa.CheckConstraint("end_time > start_time", name="ck_session_definitions_time_order"),
        sa.CheckConstraint(
            "slot_interval_minutes > 0", name="ck_session_definitions_slot_interval_positive"
        ),
        sa.CheckConstraint(
            "maximum_capacity > 0", name="ck_session_definitions_maximum_capacity_positive"
        ),
        sa.CheckConstraint(
            "maximum_capacity * slot_interval_minutes <= "
            "EXTRACT(EPOCH FROM (end_time - start_time)) / 60",
            name="ck_session_definitions_capacity_within_slots",
        ),
    )
    op.create_index("ix_session_definitions_clinic_id", "session_definitions", ["clinic_id"])
    op.create_index(
        "ix_session_definitions_schedule_definition_id",
        "session_definitions",
        ["schedule_definition_id"],
    )

    op.create_table(
        "session_occurrences",
        sa.Column("session_occurrence_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "clinic_id",
            sa.Uuid(),
            sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "doctor_id",
            sa.Uuid(),
            sa.ForeignKey("doctors.doctor_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "session_definition_id",
            sa.Uuid(),
            sa.ForeignKey("session_definitions.session_definition_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("occurrence_date", sa.Date(), nullable=False),
        sa.Column("session_name_snapshot", sa.String(80), nullable=False),
        sa.Column("start_time_snapshot", sa.Time(), nullable=False),
        sa.Column("end_time_snapshot", sa.Time(), nullable=False),
        sa.Column("slot_interval_minutes_snapshot", sa.SmallInteger(), nullable=False),
        sa.Column("maximum_capacity_snapshot", sa.SmallInteger(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="AVAILABLE"),
        sa.Column("block_reason", sa.String(500), nullable=True),
        sa.Column(
            "blocked_by",
            sa.Uuid(),
            sa.ForeignKey("users.user_id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("blocked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "session_definition_id", "occurrence_date", name="uq_occurrence_session_date"
        ),
        sa.CheckConstraint(
            "status IN ('AVAILABLE', 'BLOCKED')",
            name="ck_session_occurrences_status_allowed",
        ),
        sa.CheckConstraint(
            "end_time_snapshot > start_time_snapshot",
            name="ck_session_occurrences_snapshot_time_order",
        ),
        sa.CheckConstraint(
            "slot_interval_minutes_snapshot > 0",
            name="ck_session_occurrences_snapshot_interval_positive",
        ),
        sa.CheckConstraint(
            "maximum_capacity_snapshot > 0",
            name="ck_session_occurrences_snapshot_capacity_positive",
        ),
    )
    op.create_index("ix_session_occurrences_clinic_id", "session_occurrences", ["clinic_id"])
    op.create_index("ix_session_occurrences_doctor_id", "session_occurrences", ["doctor_id"])
    op.create_index(
        "ix_session_occurrences_session_definition_id",
        "session_occurrences",
        ["session_definition_id"],
    )
    op.create_index("ix_session_occurrences_occurrence_date", "session_occurrences", ["occurrence_date"])
    op.create_index(
        "ix_session_occurrences_doctor_date",
        "session_occurrences",
        ["clinic_id", "doctor_id", "occurrence_date"],
    )

    op.create_table(
        "fee_configurations",
        sa.Column("fee_configuration_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "clinic_id",
            sa.Uuid(),
            sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("regular_fee", sa.Numeric(12, 2), nullable=False),
        sa.Column("followup_fee", sa.Numeric(12, 2), nullable=False),
        sa.Column(
            "assistant_adjustment_allowed", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "created_by",
            sa.Uuid(),
            sa.ForeignKey("users.user_id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("clinic_id", "effective_from", name="uq_fee_clinic_effective_from"),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to >= effective_from",
            name="ck_fee_configurations_effective_date_order",
        ),
        sa.CheckConstraint("regular_fee >= 0", name="ck_fee_configurations_regular_fee_nonnegative"),
        sa.CheckConstraint("followup_fee >= 0", name="ck_fee_configurations_followup_fee_nonnegative"),
    )
    op.create_index("ix_fee_configurations_clinic_id", "fee_configurations", ["clinic_id"])
    op.execute(
        """
        ALTER TABLE fee_configurations
        ADD CONSTRAINT ex_fee_configuration_effective_period
        EXCLUDE USING gist (
          clinic_id WITH =,
          daterange(
            effective_from,
            CASE WHEN effective_to IS NULL THEN 'infinity'::date ELSE effective_to + 1 END,
            '[)'
          ) WITH &&
        )
        """
    )


def downgrade() -> None:
    op.drop_table("fee_configurations")
    op.drop_table("session_occurrences")
    op.drop_table("session_definitions")
    op.drop_table("schedule_definitions")
