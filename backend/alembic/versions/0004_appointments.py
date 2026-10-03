"""appointment engine and immutable fee adjustment history

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-03
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "appointments",
        sa.Column("appointment_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("patient_id", sa.Uuid(), sa.ForeignKey("patients.patient_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("doctor_id", sa.Uuid(), sa.ForeignKey("doctors.doctor_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("session_occurrence_id", sa.Uuid(), sa.ForeignKey("session_occurrences.session_occurrence_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("appointment_time", sa.Time(), nullable=True),
        sa.Column("appointment_type", sa.String(20), nullable=False),
        sa.Column("booking_source", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="BOOKED"),
        sa.Column("base_fee_snapshot", sa.Numeric(12, 2), nullable=False),
        sa.Column("effective_fee_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("fee_adjustment_reason", sa.String(500), nullable=True),
        sa.Column("fee_adjusted_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("fee_adjusted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("cancellation_reason", sa.String(30), nullable=True),
        sa.Column("cancellation_note", sa.String(500), nullable=True),
        sa.Column("rescheduled_from_appointment_id", sa.Uuid(), sa.ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("rescheduled_to_appointment_id", sa.Uuid(), sa.ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("capacity_override_used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("capacity_override_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("capacity_override_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("capacity_override_reason", sa.String(500), nullable=True),
        sa.Column("override_capacity_snapshot", sa.Integer(), nullable=True),
        sa.Column("override_existing_count", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("appointment_type IN ('REGULAR', 'FOLLOW_UP')", name="ck_appointments_appointment_type_allowed"),
        sa.CheckConstraint("booking_source IN ('ASSISTANT', 'ADMIN', 'WALK_IN', 'WHATSAPP', 'WEB', 'PATIENT_APP')", name="ck_appointments_booking_source_allowed"),
        sa.CheckConstraint("status IN ('BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED')", name="ck_appointments_status_allowed"),
        sa.CheckConstraint("cancellation_reason IS NULL OR cancellation_reason IN ('PATIENT_CANCELLED', 'NO_SHOW', 'DOCTOR_UNAVAILABLE', 'OTHER', 'RESCHEDULED')", name="ck_appointments_cancellation_reason_allowed"),
        sa.CheckConstraint("base_fee_snapshot >= 0", name="ck_appointments_base_fee_nonnegative"),
        sa.CheckConstraint("effective_fee_amount >= 0", name="ck_appointments_effective_fee_nonnegative"),
        sa.CheckConstraint("capacity_override_used OR (capacity_override_by IS NULL AND capacity_override_at IS NULL AND capacity_override_reason IS NULL AND override_capacity_snapshot IS NULL AND override_existing_count IS NULL)", name="ck_appointments_override_metadata_requires_flag"),
    )
    op.create_index("ix_appointments_clinic_id", "appointments", ["clinic_id"])
    op.create_index("ix_appointments_patient_id", "appointments", ["patient_id"])
    op.create_index("ix_appointments_doctor_id", "appointments", ["doctor_id"])
    op.create_index("ix_appointments_session_occurrence_id", "appointments", ["session_occurrence_id"])
    op.create_index("ix_appointments_clinic_created", "appointments", ["clinic_id", "created_at"])
    op.create_index("ix_appointments_patient_created", "appointments", ["patient_id", "created_at"])
    op.create_index("ix_appointments_doctor_status", "appointments", ["doctor_id", "status"])
    op.create_index("ix_appointments_occurrence_status", "appointments", ["session_occurrence_id", "status"])

    op.create_table(
        "appointment_fee_adjustments",
        sa.Column("fee_adjustment_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), sa.ForeignKey("appointments.appointment_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("previous_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("new_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("adjusted_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("adjusted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("previous_amount >= 0", name="ck_appointment_fee_adjustments_previous_amount_nonnegative"),
        sa.CheckConstraint("new_amount >= 0", name="ck_appointment_fee_adjustments_new_amount_nonnegative"),
    )
    op.create_index("ix_appointment_fee_adjustments_clinic_id", "appointment_fee_adjustments", ["clinic_id"])
    op.create_index("ix_appointment_fee_adjustments_appointment_id", "appointment_fee_adjustments", ["appointment_id"])

    # Belt-and-suspenders protection for normal scheduled slots. The application
    # still serializes bookings by locking SessionOccurrence; this trigger prevents
    # an accidental code path from creating a normal booking where any non-cancelled
    # appointment (including an override booking) already occupies the same time.
    op.execute("""
        CREATE OR REPLACE FUNCTION clinicflow_guard_normal_appointment_slot()
        RETURNS trigger AS $$
        BEGIN
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
    op.execute("""
        CREATE TRIGGER trg_guard_normal_appointment_slot
        BEFORE INSERT OR UPDATE OF appointment_time, status, capacity_override_used, session_occurrence_id
        ON appointments
        FOR EACH ROW EXECUTE FUNCTION clinicflow_guard_normal_appointment_slot();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_guard_normal_appointment_slot ON appointments")
    op.execute("DROP FUNCTION IF EXISTS clinicflow_guard_normal_appointment_slot()")
    op.drop_table("appointment_fee_adjustments")
    op.drop_table("appointments")
