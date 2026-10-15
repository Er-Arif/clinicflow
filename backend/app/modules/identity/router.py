from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth_throttle import auth_client_ip, auth_throttle, throttle_auth_ip
from app.core.clock import Clock, get_clock
from app.db.session import get_db
from app.modules.identity.dependencies import get_auth_context
from app.modules.identity.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    TokenPairResponse,
    UserContextResponse,
)
from app.modules.identity.service import AuthContext, AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenPairResponse)
def login(
    request: LoginRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> TokenPairResponse:
    auth_throttle.check(auth_client_ip(http_request))
    with db.begin():
        # CITEXT compares using PostgreSQL lower(), whose Unicode behavior differs
        # from Python. Normalize in the same database before assigning a budget.
        identity = db.scalar(select(func.lower(request.login_identifier.strip())))
        auth_throttle.check(None, identity)
        response = AuthService(db, clock).login(request)
    auth_throttle.success(identity)
    return response


@router.post("/refresh", response_model=TokenPairResponse, dependencies=[Depends(throttle_auth_ip)])
def refresh(
    request: RefreshRequest,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> TokenPairResponse:
    with db.begin():
        return AuthService(db, clock).refresh(request.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> Response:
    with db.begin():
        AuthService(db, clock).logout(context)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserContextResponse)
def me(context: AuthContext = Depends(get_auth_context)) -> UserContextResponse:
    return UserContextResponse(
        user_id=context.user_id,
        clinic_id=context.clinic_id,
        display_name=context.display_name,
        roles=sorted(context.roles),
        permissions=sorted(context.permissions),
        must_change_password=context.must_change_password,
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(throttle_auth_ip)])
def change_password(
    request: ChangePasswordRequest,
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> Response:
    with db.begin():
        AuthService(db, clock).change_password(context, request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
