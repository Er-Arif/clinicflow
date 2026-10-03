from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.db.session import get_db
from app.modules.identity.admin_schemas import (
    PasswordResetRequest,
    RolePresetResponse,
    UserAdminResponse,
    UserCreateRequest,
    UserListResponse,
    UserUpdateRequest,
)
from app.modules.identity.admin_service import UserAdminService
from app.modules.identity.dependencies import require_permission
from app.modules.identity.service import AuthContext

router = APIRouter(tags=["users"])


@router.get("/roles", response_model=list[RolePresetResponse])
def role_presets(
    context: AuthContext = Depends(require_permission("users.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> list[RolePresetResponse]:
    return UserAdminService(db, clock, context).role_presets()


@router.get("/users", response_model=UserListResponse)
def list_users(
    context: AuthContext = Depends(require_permission("users.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> UserListResponse:
    return UserAdminService(db, clock, context).list_users()


@router.post("/users", response_model=UserAdminResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    request: UserCreateRequest,
    context: AuthContext = Depends(require_permission("users.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> UserAdminResponse:
    with db.begin():
        return UserAdminService(db, clock, context).create(request)


@router.get("/users/{user_id}", response_model=UserAdminResponse)
def get_user(
    user_id: UUID,
    context: AuthContext = Depends(require_permission("users.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> UserAdminResponse:
    return UserAdminService(db, clock, context).get_user(user_id)


@router.patch("/users/{user_id}", response_model=UserAdminResponse)
def update_user(
    user_id: UUID,
    request: UserUpdateRequest,
    context: AuthContext = Depends(require_permission("users.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> UserAdminResponse:
    with db.begin():
        return UserAdminService(db, clock, context).update(user_id, request)


@router.post("/users/{user_id}/reset-password", response_model=UserAdminResponse)
def reset_user_password(
    user_id: UUID,
    request: PasswordResetRequest,
    context: AuthContext = Depends(require_permission("users.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> UserAdminResponse:
    with db.begin():
        return UserAdminService(db, clock, context).reset_password(
            user_id, request.temporary_password, request.reason
        )
