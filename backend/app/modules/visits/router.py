from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.core.errors import AppError
from app.db.session import get_db
from app.modules.followups.schemas import VisitCompleteRequest, VisitCompletionResponse
from app.modules.identity.dependencies import (
    ensure_password_ready,
    get_auth_context,
    require_permission,
)
from app.modules.identity.service import AuthContext
from app.modules.visits.schemas import CheckInResponse, VisitResponse, WalkInRequest
from app.modules.visits.service import VisitService

router = APIRouter(tags=["visits"])


def _idempotency_key(value: str | None) -> str:
    if value is None or not value.strip():
        raise AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.", 422)
    return value.strip()


@router.post("/walk-ins", response_model=CheckInResponse, status_code=201)
def add_walk_in(
    request: WalkInRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> CheckInResponse:
    ensure_password_ready(context)
    required = {"appointment.create", "appointment.check_in"}
    if not required.issubset(context.permissions):
        raise AppError("PERMISSION_DENIED", "You don't have permission to add walk-ins.", 403)
    with db.begin():
        return VisitService(db, clock, context).walk_in(
            request, idempotency_key=_idempotency_key(idempotency_key)
        )


@router.get("/visits/{visit_id}", response_model=VisitResponse)
def get_visit(
    visit_id: UUID,
    context: AuthContext = Depends(require_permission("visit.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> VisitResponse:
    return VisitService(db, clock, context).get(visit_id)


@router.post("/visits/{visit_id}/complete", response_model=VisitCompletionResponse)
def complete_visit(
    visit_id: UUID,
    request: VisitCompleteRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    context: AuthContext = Depends(require_permission("visit.complete")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> VisitCompletionResponse:
    with db.begin():
        return VisitService(db, clock, context).complete(
            visit_id, request, idempotency_key=_idempotency_key(idempotency_key)
        )
