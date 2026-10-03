from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    LargeBinary,
    Integer,
    PrimaryKeyConstraint,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("clinic_id", "login_identifier", name="uq_users_clinic_login_identifier"),
    )

    user_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    login_identifier: Mapped[str] = mapped_column(CITEXT, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("clinic_id", "role_code", name="uq_roles_clinic_role_code"),
    )

    role_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=True
    )
    role_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    system_role: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Permission(Base):
    __tablename__ = "permissions"

    permission_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    permission_code: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (PrimaryKeyConstraint("user_id", "role_id", name="pk_user_roles"),)

    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False
    )
    role_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("roles.role_id", ondelete="RESTRICT"), nullable=False
    )
    assigned_by: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=True
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        PrimaryKeyConstraint("role_id", "permission_id", name="pk_role_permissions"),
    )

    role_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("roles.role_id", ondelete="RESTRICT"), nullable=False
    )
    permission_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("permissions.permission_id", ondelete="RESTRICT"), nullable=False
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    session_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("clinics.clinic_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False, index=True
    )
    refresh_token_hash: Mapped[bytes] = mapped_column(
        LargeBinary(32), nullable=False, unique=True, index=True
    )
    device_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
