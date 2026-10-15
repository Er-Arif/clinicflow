from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.context import request_id_var
from app.core.errors import AppError
from app.core.security import PasswordService
from app.modules.audit.service import AuditService
from app.modules.clinic.models import Clinic, Doctor
from app.modules.identity.admin_schemas import (
    ALLOWED_ROLE_CODES,
    RolePresetResponse,
    UserAdminResponse,
    UserCreateRequest,
    UserListResponse,
    UserUpdateRequest,
)
from app.modules.identity.models import AuthSession, Role, User, UserRole
from app.modules.identity.service import AuthContext


def _request_id() -> UUID:
    value = request_id_var.get()
    if value is None:
        raise RuntimeError("Request ID is unavailable")
    return UUID(value)


def _clean_required(value: str, *, field: str) -> str:
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        raise AppError("VALIDATION_ERROR", f"{field} is required.", 422)
    return cleaned


def validate_new_password(password: str) -> None:
    if len(password) < 10:
        raise AppError(
            "PASSWORD_TOO_SHORT",
            "Password must contain at least 10 characters.",
            422,
        )
    if len(password) > 128:
        raise AppError("PASSWORD_TOO_LONG", "Password is too long.", 422)


class UserAdminService:
    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def role_presets(self) -> list[RolePresetResponse]:
        roles = self.db.scalars(
            select(Role)
            .where(
                Role.clinic_id.is_(None),
                Role.system_role.is_(True),
                Role.active.is_(True),
                Role.role_code.in_(sorted(ALLOWED_ROLE_CODES)),
            )
            .order_by(Role.role_code)
        ).all()
        return [RolePresetResponse(role_code=r.role_code, display_name=r.display_name) for r in roles]

    def list_users(self) -> UserListResponse:
        users = self.db.scalars(
            select(User)
            .where(User.clinic_id == self.context.clinic_id)
            .order_by(User.active.desc(), User.display_name, User.login_identifier)
        ).all()
        return UserListResponse(items=[self._response(item) for item in users])

    def get_user(self, user_id: UUID) -> UserAdminResponse:
        user = self._get_user(user_id)
        return self._response(user)

    def create(self, request: UserCreateRequest) -> UserAdminResponse:
        if "OWNER_ADMIN" in request.role_codes:
            self._lock_clinic_authority()
        display_name = _clean_required(request.display_name, field="Name")
        login_identifier = request.login_identifier.strip()
        validate_new_password(request.temporary_password)
        self._assert_login_available(login_identifier)
        roles = self._roles(request.role_codes)

        user = User(
            clinic_id=self.context.clinic_id,
            display_name=display_name,
            login_identifier=login_identifier,
            password_hash=PasswordService.hash(request.temporary_password),
            active=True,
            must_change_password=True,
            version=1,
        )
        self.db.add(user)
        self.db.flush()
        for role in roles:
            self.db.add(
                UserRole(
                    user_id=user.user_id,
                    role_id=role.role_id,
                    assigned_by=self.context.user_id,
                )
            )
        if "DOCTOR" in request.role_codes:
            self._ensure_doctor_link(user)
        self.db.flush()

        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="USER_CREATED",
            entity_type="USER",
            entity_id=user.user_id,
            request_id=_request_id(),
            new_values={
                "display_name": user.display_name,
                "login_identifier": str(user.login_identifier),
                "active": user.active,
                "roles": sorted(request.role_codes),
                "must_change_password": True,
            },
        )
        return self._response(user)

    def update(self, user_id: UUID, request: UserUpdateRequest) -> UserAdminResponse:
        if request.role_codes is not None or request.active is not None:
            self._lock_clinic_authority()
        user = self.db.scalar(
            select(User)
            .where(User.user_id == user_id, User.clinic_id == self.context.clinic_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if user is None:
            self._not_found()
        if user.version != request.expected_version:
            raise AppError(
                "STALE_VERSION",
                "This user was changed by another administrator. Reload and try again.",
                409,
                {"current_version": user.version},
            )

        previous_roles = self._role_codes(user.user_id)
        previous = self._audit_values(user, previous_roles)
        fields = request.model_fields_set

        if "display_name" in fields and request.display_name is not None:
            user.display_name = _clean_required(request.display_name, field="Name")
        if "login_identifier" in fields and request.login_identifier is not None:
            login_identifier = request.login_identifier.strip()
            self._assert_login_available(login_identifier, exclude_user_id=user.user_id)
            user.login_identifier = login_identifier

        next_roles = previous_roles
        if "role_codes" in fields and request.role_codes is not None:
            next_roles = set(request.role_codes)

        next_active = user.active if "active" not in fields or request.active is None else request.active
        if user.user_id == self.context.user_id and not next_active:
            raise AppError(
                "SELF_DISABLE_NOT_ALLOWED",
                "You cannot disable your own account.",
                409,
            )
        if ("OWNER_ADMIN" in previous_roles) and (
            "OWNER_ADMIN" not in next_roles or not next_active
        ):
            self._assert_another_active_owner(user.user_id)

        role_changed = next_roles != previous_roles
        if role_changed:
            roles = self._roles(sorted(next_roles))
            self.db.execute(delete(UserRole).where(UserRole.user_id == user.user_id))
            for role in roles:
                self.db.add(
                    UserRole(
                        user_id=user.user_id,
                        role_id=role.role_id,
                        assigned_by=self.context.user_id,
                    )
                )
            if "DOCTOR" in next_roles:
                self._ensure_doctor_link(user)

        if user.active != next_active:
            user.active = next_active
            if not next_active:
                self._revoke_sessions(user.user_id)

        user.version += 1
        self.db.flush()
        current_roles = self._role_codes(user.user_id)
        current = self._audit_values(user, current_roles)

        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="USER_UPDATED",
            entity_type="USER",
            entity_id=user.user_id,
            request_id=_request_id(),
            previous_values=previous,
            new_values=current,
        )
        if role_changed:
            AuditService(self.db).record(
                clinic_id=self.context.clinic_id,
                actor_type="USER",
                actor_user_id=self.context.user_id,
                action_type="USER_ROLE_CHANGED",
                entity_type="USER",
                entity_id=user.user_id,
                request_id=_request_id(),
                previous_values={"roles": sorted(previous_roles)},
                new_values={"roles": sorted(current_roles)},
            )
        if previous["active"] is True and current["active"] is False:
            AuditService(self.db).record(
                clinic_id=self.context.clinic_id,
                actor_type="USER",
                actor_user_id=self.context.user_id,
                action_type="USER_DISABLED",
                entity_type="USER",
                entity_id=user.user_id,
                request_id=_request_id(),
            )
        return self._response(user)

    def reset_password(self, user_id: UUID, temporary_password: str, reason: str) -> UserAdminResponse:
        if user_id == self.context.user_id:
            raise AppError(
                "SELF_RESET_NOT_ALLOWED",
                "Use Change Password for your own account.",
                409,
            )
        validate_new_password(temporary_password)
        user = self.db.scalar(
            select(User)
            .where(User.user_id == user_id, User.clinic_id == self.context.clinic_id)
            .with_for_update()
        )
        if user is None:
            self._not_found()
        user.password_hash = PasswordService.hash(temporary_password)
        user.must_change_password = True
        user.version += 1
        self._revoke_sessions(user.user_id)
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="USER_CREDENTIAL_RESET",
            entity_type="USER",
            entity_id=user.user_id,
            request_id=_request_id(),
            reason=reason.strip(),
            new_values={"must_change_password": True, "sessions_revoked": True},
        )
        return self._response(user)

    def _assert_login_available(self, login_identifier: str, exclude_user_id: UUID | None = None) -> None:
        query = select(User.user_id).where(
            User.clinic_id == self.context.clinic_id,
            User.login_identifier == login_identifier,
        )
        if exclude_user_id is not None:
            query = query.where(User.user_id != exclude_user_id)
        if self.db.scalar(query) is not None:
            raise AppError(
                "LOGIN_IDENTIFIER_IN_USE",
                "This login identifier is already in use.",
                409,
            )

    def _roles(self, role_codes: list[str]) -> list[Role]:
        requested = set(role_codes)
        if not requested or requested - ALLOWED_ROLE_CODES:
            raise AppError("INVALID_ROLE", "Select valid ClinicFlow roles.", 422)
        roles = self.db.scalars(
            select(Role).where(
                Role.clinic_id.is_(None),
                Role.role_code.in_(sorted(requested)),
                Role.system_role.is_(True),
                Role.active.is_(True),
            )
        ).all()
        if {role.role_code for role in roles} != requested:
            raise AppError("INVALID_ROLE", "One or more roles are unavailable.", 422)
        return list(roles)

    def _role_codes(self, user_id: UUID) -> set[str]:
        return set(
            self.db.scalars(
                select(Role.role_code)
                .join(UserRole, UserRole.role_id == Role.role_id)
                .where(UserRole.user_id == user_id, Role.active.is_(True))
            ).all()
        )

    def _lock_clinic_authority(self) -> None:
        # All authority additions/removals take this before any user row lock.
        # NO KEY UPDATE serializes the count + mutation while allowing FK KEY SHARE
        # checks from unrelated user/audit inserts. The caller owns the transaction.
        clinic_id = self.db.scalar(
            select(Clinic.clinic_id)
            .where(Clinic.clinic_id == self.context.clinic_id)
            .with_for_update(key_share=True)
        )
        if clinic_id is None:
            raise AppError("CLINIC_NOT_FOUND", "Clinic configuration was not found.", 404)

    def _assert_another_active_owner(self, user_id: UUID) -> None:
        owner_role_id = self.db.scalar(
            select(Role.role_id).where(Role.clinic_id.is_(None), Role.role_code == "OWNER_ADMIN")
        )
        if owner_role_id is None:
            raise RuntimeError("OWNER_ADMIN role is missing")
        count = self.db.scalar(
            select(func.count(User.user_id))
            .join(UserRole, UserRole.user_id == User.user_id)
            .where(
                User.clinic_id == self.context.clinic_id,
                User.active.is_(True),
                User.user_id != user_id,
                UserRole.role_id == owner_role_id,
            )
        ) or 0
        if count < 1:
            raise AppError(
                "LAST_OWNER_ADMIN_REQUIRED",
                "At least one active Owner/Admin account must remain.",
                409,
            )

    def _ensure_doctor_link(self, user: User) -> Doctor:
        doctor = self.db.scalar(
            select(Doctor).where(
                Doctor.clinic_id == self.context.clinic_id,
                Doctor.user_id == user.user_id,
            )
        )
        if doctor is None:
            doctor = Doctor(
                clinic_id=self.context.clinic_id,
                user_id=user.user_id,
                display_name=user.display_name,
                active=True,
                version=1,
            )
            self.db.add(doctor)
            self.db.flush()
        return doctor

    def _revoke_sessions(self, user_id: UUID, *, except_session_id: UUID | None = None) -> None:
        conditions = [
            AuthSession.clinic_id == self.context.clinic_id,
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
        ]
        if except_session_id is not None:
            conditions.append(AuthSession.session_id != except_session_id)
        self.db.execute(
            update(AuthSession)
            .where(*conditions)
            .values(revoked_at=self.clock.now_utc())
        )

    def _get_user(self, user_id: UUID) -> User:
        user = self.db.scalar(
            select(User).where(User.user_id == user_id, User.clinic_id == self.context.clinic_id)
        )
        if user is None:
            self._not_found()
        return user

    def _response(self, user: User) -> UserAdminResponse:
        doctor_id = self.db.scalar(
            select(Doctor.doctor_id).where(
                Doctor.clinic_id == self.context.clinic_id,
                Doctor.user_id == user.user_id,
            )
        )
        return UserAdminResponse(
            user_id=user.user_id,
            display_name=user.display_name,
            login_identifier=str(user.login_identifier),
            active=user.active,
            must_change_password=user.must_change_password,
            roles=sorted(self._role_codes(user.user_id)),
            linked_doctor_id=doctor_id,
            last_login_at=user.last_login_at,
            version=user.version,
        )

    @staticmethod
    def _audit_values(user: User, roles: set[str]) -> dict[str, object]:
        return {
            "display_name": user.display_name,
            "login_identifier": str(user.login_identifier),
            "active": user.active,
            "must_change_password": user.must_change_password,
            "roles": sorted(roles),
            "version": user.version,
        }

    @staticmethod
    def _not_found() -> None:
        raise AppError("USER_NOT_FOUND", "User account was not found.", 404)
