from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from functools import lru_cache
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import settings
from app.core.context import request_id_var
from app.core.errors import AppError
from app.core.security import PasswordService, TokenService
from app.modules.audit.service import AuditService
from app.modules.identity.models import (
    AuthSession,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
)
from app.modules.identity.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    TokenPairResponse,
    UserContextResponse,
)


@dataclass(frozen=True, slots=True)
class AuthContext:
    user_id: UUID
    clinic_id: UUID
    session_id: UUID
    display_name: str
    roles: frozenset[str]
    permissions: frozenset[str]
    must_change_password: bool


@lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    # Unknown/ambiguous identities still pay the normal password-verification cost.
    return PasswordService.hash("not-an-account-password")


def _request_id() -> UUID:
    value = request_id_var.get()
    if value is None:
        raise RuntimeError("Request ID is unavailable")
    return UUID(value)


def _validate_new_password(password: str) -> None:
    if len(password) < 10:
        raise AppError("PASSWORD_TOO_SHORT", "Password must contain at least 10 characters.", 422)
    if len(password) > 128:
        raise AppError("PASSWORD_TOO_LONG", "Password is too long.", 422)


class AuthService:
    def __init__(self, db: Session, clock: Clock):
        self.db = db
        self.clock = clock
        self.tokens = TokenService(clock)

    def login(self, request: LoginRequest) -> TokenPairResponse:
        users = self.db.scalars(
            select(User).where(User.login_identifier == request.login_identifier.strip())
        ).all()
        user = users[0] if len(users) == 1 else None
        valid = PasswordService.verify(
            user.password_hash if user is not None else _dummy_password_hash(), request.password
        )
        if user is None or not valid or not user.active:
            self._invalid_credentials()

        raw_refresh = self.tokens.new_refresh_token()
        now = self.clock.now_utc()
        session = AuthSession(
            clinic_id=user.clinic_id,
            user_id=user.user_id,
            refresh_token_hash=self.tokens.hash_refresh_token(raw_refresh),
            device_label=request.device_label,
            last_used_at=now,
            expires_at=now + timedelta(days=settings.refresh_session_days),
        )
        user.last_login_at = now
        self.db.add(session)
        self.db.flush()

        context = self._context_for(user=user, session=session)
        return self._token_response(context=context, refresh_token=raw_refresh)

    def refresh(self, refresh_token: str) -> TokenPairResponse:
        digest = self.tokens.hash_refresh_token(refresh_token)
        session = self.db.scalar(
            select(AuthSession).where(AuthSession.refresh_token_hash == digest).with_for_update()
        )
        if session is None or session.revoked_at is not None or session.expires_at <= self.clock.now_utc():
            raise AppError(
                code="REFRESH_SESSION_INVALID",
                message="Your session has expired. Sign in again.",
                status_code=401,
            )

        user = self.db.get(User, session.user_id)
        if user is None or not user.active or user.clinic_id != session.clinic_id:
            raise AppError(
                code="ACCOUNT_DISABLED",
                message="This account is no longer available.",
                status_code=403,
            )

        raw_refresh = self.tokens.new_refresh_token()
        session.refresh_token_hash = self.tokens.hash_refresh_token(raw_refresh)
        session.last_used_at = self.clock.now_utc()
        self.db.flush()
        context = self._context_for(user=user, session=session)
        return self._token_response(context=context, refresh_token=raw_refresh)

    def context_from_access_token(self, token: str) -> AuthContext:
        claims = self.tokens.decode_access_token(token)
        session = self.db.get(AuthSession, claims.session_id)
        if (
            session is None
            or session.user_id != claims.user_id
            or session.clinic_id != claims.clinic_id
            or session.revoked_at is not None
            or session.expires_at <= self.clock.now_utc()
        ):
            raise AppError(
                code="AUTHENTICATION_REQUIRED",
                message="Your session is invalid or has expired.",
                status_code=401,
            )
        user = self.db.get(User, claims.user_id)
        if user is None or not user.active or user.clinic_id != claims.clinic_id:
            raise AppError(
                code="ACCOUNT_DISABLED",
                message="This account has been disabled.",
                status_code=403,
            )
        return self._context_for(user=user, session=session)

    def logout(self, context: AuthContext) -> None:
        session = self.db.get(AuthSession, context.session_id)
        if session is not None and session.revoked_at is None:
            session.revoked_at = self.clock.now_utc()

    def change_password(self, context: AuthContext, request: ChangePasswordRequest) -> None:
        user = self.db.scalar(
            select(User)
            .where(User.user_id == context.user_id, User.clinic_id == context.clinic_id)
            .with_for_update()
        )
        if user is None or not user.active:
            raise AppError("ACCOUNT_DISABLED", "This account is no longer available.", 403)
        if not PasswordService.verify(user.password_hash, request.current_password):
            raise AppError("CURRENT_PASSWORD_INCORRECT", "Current password is incorrect.", 422)
        _validate_new_password(request.new_password)
        if PasswordService.verify(user.password_hash, request.new_password):
            raise AppError("PASSWORD_UNCHANGED", "Choose a new password different from the current password.", 422)

        user.password_hash = PasswordService.hash(request.new_password)
        user.must_change_password = False
        user.version += 1
        now = self.clock.now_utc()
        self.db.query(AuthSession).filter(
            AuthSession.clinic_id == context.clinic_id,
            AuthSession.user_id == context.user_id,
            AuthSession.session_id != context.session_id,
            AuthSession.revoked_at.is_(None),
        ).update({AuthSession.revoked_at: now}, synchronize_session=False)
        AuditService(self.db).record(
            clinic_id=context.clinic_id,
            actor_type="USER",
            actor_user_id=context.user_id,
            action_type="PASSWORD_CHANGED",
            entity_type="USER",
            entity_id=context.user_id,
            request_id=_request_id(),
            new_values={"must_change_password": False, "other_sessions_revoked": True},
        )

    def _context_for(self, *, user: User, session: AuthSession) -> AuthContext:
        role_codes = set(
            self.db.scalars(
                select(Role.role_code)
                .join(UserRole, UserRole.role_id == Role.role_id)
                .where(UserRole.user_id == user.user_id, Role.active.is_(True))
            ).all()
        )
        permission_codes = set(
            self.db.scalars(
                select(Permission.permission_code)
                .join(RolePermission, RolePermission.permission_id == Permission.permission_id)
                .join(UserRole, UserRole.role_id == RolePermission.role_id)
                .join(Role, Role.role_id == UserRole.role_id)
                .where(UserRole.user_id == user.user_id, Role.active.is_(True))
                .distinct()
            ).all()
        )
        return AuthContext(
            user_id=user.user_id,
            clinic_id=user.clinic_id,
            session_id=session.session_id,
            display_name=user.display_name,
            roles=frozenset(role_codes),
            permissions=frozenset(permission_codes),
            must_change_password=user.must_change_password,
        )

    def _token_response(self, *, context: AuthContext, refresh_token: str) -> TokenPairResponse:
        access = self.tokens.create_access_token(
            user_id=context.user_id,
            clinic_id=context.clinic_id,
            session_id=context.session_id,
        )
        return TokenPairResponse(
            access_token=access,
            refresh_token=refresh_token,
            expires_in=settings.access_token_minutes * 60,
            user=UserContextResponse(
                user_id=context.user_id,
                clinic_id=context.clinic_id,
                display_name=context.display_name,
                roles=sorted(context.roles),
                permissions=sorted(context.permissions),
                must_change_password=context.must_change_password,
            ),
        )

    @staticmethod
    def _invalid_credentials() -> None:
        raise AppError(
            code="INVALID_CREDENTIALS",
            message="Username or password is incorrect.",
            status_code=401,
        )
