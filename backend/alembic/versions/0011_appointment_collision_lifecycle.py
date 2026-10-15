"""Preserve authorized overlaps during occupancy-preserving lifecycle updates.

Revision ID: 0011
Revises: 0010
"""

from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels = None
depends_on = None


def _replace_guard(*, preserve_occupancy: bool) -> None:
    # The trigger's collision identity is occurrence + time. The occurrence
    # anchors doctor/date/session; rescheduling creates a replacement appointment.
    unchanged_occupancy = (
        """
            IF TG_OP = 'UPDATE' THEN
                IF OLD.status <> 'CANCELLED' AND NEW.status <> 'CANCELLED'
                   AND NEW.session_occurrence_id IS NOT DISTINCT FROM OLD.session_occurrence_id
                   AND NEW.appointment_time IS NOT DISTINCT FROM OLD.appointment_time
                   AND NEW.capacity_override_used IS NOT DISTINCT FROM OLD.capacity_override_used THEN
                    RETURN NEW;
                END IF;
            END IF;
    """
        if preserve_occupancy
        else ""
    )
    # Keep the original collision query, including override rows. Only the NEW
    # appointment's own override permits a new/moved collision.
    op.execute(f"""
        CREATE OR REPLACE FUNCTION clinicflow_guard_normal_appointment_slot()
        RETURNS trigger AS $$
        BEGIN
            {unchanged_occupancy}
            IF NEW.appointment_time IS NOT NULL
               AND NEW.status <> 'CANCELLED'
               AND NEW.capacity_override_used = FALSE THEN
                IF EXISTS (
                    SELECT 1 FROM appointments a
                    WHERE a.session_occurrence_id = NEW.session_occurrence_id
                      AND a.appointment_time = NEW.appointment_time
                      AND a.status <> 'CANCELLED'
                      AND a.appointment_id <> NEW.appointment_id
                ) THEN
                    RAISE EXCEPTION 'normal appointment slot already occupied'
                        USING ERRCODE = 'unique_violation';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)


def upgrade() -> None:
    _replace_guard(preserve_occupancy=True)


def downgrade() -> None:
    _replace_guard(preserve_occupancy=False)
