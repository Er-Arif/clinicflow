from collections.abc import Callable

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.core.errors import AppError
from app.db.session import get_auth_db
from app.modules.identity.service import AuthContext, AuthService

_bearer = HTTPBearer(auto_error=False)


def get_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_auth_db),
    clock: Clock = Depends(get_clock),
) -> AuthContext:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(
            code="AUTHENTICATION_REQUIRED",
            message="Sign in to continue.",
            status_code=401,
        )
    return AuthService(db, clock).context_from_access_token(credentials.credentials)


def ensure_password_ready(context: AuthContext) -> AuthContext:
    if context.must_change_password:
        raise AppError(
            code="PASSWORD_CHANGE_REQUIRED",
            message="Change your temporary password before continuing.",
            status_code=403,
        )
    return context


def require_permission(permission: str) -> Callable[[AuthContext], AuthContext]:
    def dependency(context: AuthContext = Depends(get_auth_context)) -> AuthContext:
        ensure_password_ready(context)
        if permission not in context.permissions:
            raise AppError(
                code="PERMISSION_DENIED",
                message="You don't have permission to perform this action.",
                status_code=403,
            )
        return context

    return dependency
