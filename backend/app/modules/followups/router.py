from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.core.errors import AppError
from app.db.session import get_db
from app.modules.followups.schemas import (
    FollowUpBookRequest,
    FollowUpBookResponse,
    FollowUpCloseRequest,
    FollowUpListResponse,
    FollowUpResponse,
)
from app.modules.followups.service import FollowUpService
from app.modules.identity.dependencies import require_permission
from app.modules.identity.service import AuthContext

router = APIRouter(tags=["follow-ups"])


def _idempotency_key(value: str | None) -> str:
    if value is None or not value.strip():
        raise AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.", 422)
    return value.strip()


@router.get("/followups", response_model=FollowUpListResponse)
def list_followups(
    state: str | None = Query(default=None),
    patient_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    context: AuthContext = Depends(require_permission("followup.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> FollowUpListResponse:
    return FollowUpService(db, clock, context).list(
        state=state, patient_id=patient_id, limit=limit, offset=offset
    )


@router.get("/followups/{followup_id}", response_model=FollowUpResponse)
def get_followup(
    followup_id: UUID,
    context: AuthContext = Depends(require_permission("followup.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> FollowUpResponse:
    return FollowUpService(db, clock, context).get(followup_id)


@router.post("/followups/{followup_id}/book", response_model=FollowUpBookResponse)
def book_followup(
    followup_id: UUID,
    request: FollowUpBookRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    context: AuthContext = Depends(require_permission("followup.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> FollowUpBookResponse:
    with db.begin():
        return FollowUpService(db, clock, context).book(
            followup_id, request, idempotency_key=_idempotency_key(idempotency_key)
        )


@router.post("/followups/{followup_id}/close", response_model=FollowUpResponse)
def close_followup(
    followup_id: UUID,
    request: FollowUpCloseRequest,
    context: AuthContext = Depends(require_permission("followup.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> FollowUpResponse:
    with db.begin():
        return FollowUpService(db, clock, context).close(followup_id, request)
