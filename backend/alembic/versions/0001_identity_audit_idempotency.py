"""identity, clinic, audit and idempotency foundation

Revision ID: 0001
Revises:
Create Date: 2026-10-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS citext')
    op.execute('CREATE EXTENSION IF NOT EXISTS pgcrypto')

    op.create_table(
        "clinics",
        sa.Column("clinic_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_name", sa.String(160), nullable=False),
        sa.Column("address", sa.String(1000), nullable=True),
        sa.Column("contact_number", sa.String(32), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "users",
        sa.Column("user_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("display_name", sa.String(160), nullable=False),
        sa.Column("login_identifier", postgresql.CITEXT(), nullable=False),
        sa.Column("password_hash", sa.String(512), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("clinic_id", "login_identifier", name="uq_users_clinic_login_identifier"),
    )
    op.create_index("ix_users_clinic_id", "users", ["clinic_id"])

    op.create_table(
        "roles",
        sa.Column("role_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("role_code", sa.String(64), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("system_role", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint("clinic_id", "role_code", name="uq_roles_clinic_role_code"),
    )
    op.create_index("ix_roles_role_code", "roles", ["role_code"])
    op.execute("CREATE UNIQUE INDEX uq_roles_global_role_code ON roles (role_code) WHERE clinic_id IS NULL")

    op.create_table(
        "permissions",
        sa.Column("permission_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("permission_code", sa.String(100), nullable=False, unique=True),
        sa.Column("description", sa.String(255), nullable=False),
    )

    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("role_id", sa.Uuid(), sa.ForeignKey("roles.role_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("assigned_by", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("user_id", "role_id", name="pk_user_roles"),
    )

    op.create_table(
        "role_permissions",
        sa.Column("role_id", sa.Uuid(), sa.ForeignKey("roles.role_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("permission_id", sa.Uuid(), sa.ForeignKey("permissions.permission_id", ondelete="RESTRICT"), nullable=False),
        sa.PrimaryKeyConstraint("role_id", "permission_id", name="pk_role_permissions"),
    )

    op.create_table(
        "auth_sessions",
        sa.Column("session_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("refresh_token_hash", sa.LargeBinary(32), nullable=False, unique=True),
        sa.Column("device_label", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_auth_sessions_user_id", "auth_sessions", ["user_id"])
    op.create_index("ix_auth_sessions_clinic_id", "auth_sessions", ["clinic_id"])
    op.create_index("ix_auth_sessions_refresh_token_hash", "auth_sessions", ["refresh_token_hash"], unique=True)
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])

    op.create_table(
        "doctors",
        sa.Column("doctor_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True, unique=True),
        sa.Column("display_name", sa.String(160), nullable=False),
        sa.Column("professional_display_details", sa.String(255), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_doctors_clinic_id", "doctors", ["clinic_id"])

    op.create_table(
        "audit_events",
        sa.Column("audit_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("actor_type", sa.String(16), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("action_type", sa.String(80), nullable=False),
        sa.Column("entity_type", sa.String(80), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("previous_values", postgresql.JSONB(), nullable=True),
        sa.Column("new_values", postgresql.JSONB(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("actor_type IN ('USER', 'SYSTEM')", name="ck_audit_events_actor_type_allowed"),
    )
    for column in ["clinic_id", "actor_user_id", "action_type", "entity_type", "entity_id", "request_id", "occurred_at"]:
        op.create_index(f"ix_audit_events_{column}", "audit_events", [column])

    op.execute("""
        CREATE OR REPLACE FUNCTION clinicflow_reject_audit_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'audit_events is append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_audit_events_append_only
        BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION clinicflow_reject_audit_mutation();
    """)

    op.create_table(
        "idempotency_records",
        sa.Column("idempotency_id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("clinic_id", sa.Uuid(), sa.ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("operation", sa.String(80), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_body", postgresql.JSONB(), nullable=True),
        sa.Column("resource_type", sa.String(80), nullable=True),
        sa.Column("resource_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "operation", "idempotency_key", name="uq_idempotency_user_operation_key"),
    )
    op.create_index("ix_idempotency_records_clinic_id", "idempotency_records", ["clinic_id"])
    op.create_index("ix_idempotency_records_user_id", "idempotency_records", ["user_id"])

    roles = [
        ("ASSISTANT", "Assistant"),
        ("DOCTOR", "Doctor"),
        ("OWNER_ADMIN", "Owner / Admin"),
    ]
    for code, name in roles:
        op.execute(sa.text("INSERT INTO roles (role_id, clinic_id, role_code, display_name, system_role, active) VALUES (gen_random_uuid(), NULL, :code, :name, TRUE, TRUE)").bindparams(code=code, name=name))

    permissions = {
        "patient.read": "View patient administrative information",
        "patient.create": "Register patients",
        "patient.edit": "Edit patient administrative information",
        "appointment.read": "View appointments",
        "appointment.create": "Create appointments",
        "appointment.cancel": "Cancel appointments",
        "appointment.reschedule": "Reschedule appointments",
        "appointment.check_in": "Check in appointments",
        "appointment.capacity_override": "Override normal appointment capacity",
        "visit.read": "View visit history",
        "visit.complete": "Complete visits",
        "payment.read": "View payment state",
        "payment.confirm": "Confirm payments",
        "payment.void": "Void confirmed payments",
        "followup.read": "View follow-ups",
        "followup.manage": "Create, book and close follow-ups",
        "reminder.manage": "Prepare, send-mark and skip reminders",
        "session.block": "Block or unblock session occurrences",
        "schedule.manage": "Manage recurring schedules",
        "fee.manage": "Manage clinic fees",
        "upi.manage": "Manage UPI configuration",
        "message_templates.manage": "Manage message templates",
        "clinic.settings.manage": "Manage clinic and doctor settings",
        "reports.view": "View clinic reports and dashboard",
        "users.manage": "Manage staff accounts and roles",
        "audit.view": "View audit history",
    }
    for code, description in permissions.items():
        op.execute(sa.text("INSERT INTO permissions (permission_id, permission_code, description) VALUES (gen_random_uuid(), :code, :description)").bindparams(code=code, description=description))

    assistant = [
        "patient.read", "patient.create", "patient.edit", "appointment.read", "appointment.create",
        "appointment.cancel", "appointment.reschedule", "appointment.check_in", "visit.read",
        "visit.complete", "payment.read", "payment.confirm", "followup.read", "followup.manage",
        "reminder.manage",
    ]
    doctor = ["patient.read", "appointment.read", "visit.read", "followup.read", "payment.read"]
    for role_code, codes in [("ASSISTANT", assistant), ("DOCTOR", doctor)]:
        for code in codes:
            op.execute(sa.text("""
                INSERT INTO role_permissions (role_id, permission_id)
                SELECT r.role_id, p.permission_id FROM roles r, permissions p
                WHERE r.role_code = :role_code AND r.clinic_id IS NULL AND p.permission_code = :permission_code
            """).bindparams(role_code=role_code, permission_code=code))
    op.execute("""
        INSERT INTO role_permissions (role_id, permission_id)
        SELECT r.role_id, p.permission_id FROM roles r CROSS JOIN permissions p
        WHERE r.role_code = 'OWNER_ADMIN' AND r.clinic_id IS NULL
    """)


def downgrade() -> None:
    op.drop_table("idempotency_records")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_events_append_only ON audit_events")
    op.execute("DROP FUNCTION IF EXISTS clinicflow_reject_audit_mutation()")
    op.drop_table("audit_events")
    op.drop_table("doctors")
    op.drop_table("auth_sessions")
    op.drop_table("role_permissions")
    op.drop_table("user_roles")
    op.drop_table("permissions")
    op.drop_index("uq_roles_global_role_code", table_name="roles")
    op.drop_table("roles")
    op.drop_table("users")
    op.drop_table("clinics")
