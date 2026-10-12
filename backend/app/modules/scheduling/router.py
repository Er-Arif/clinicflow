from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.db.session import get_db
from app.modules.identity.dependencies import (
    ensure_password_ready,
    get_auth_context,
    require_permission,
)
from app.modules.identity.service import AuthContext
from app.modules.scheduling.schemas import (
    BlockSessionRequest,
    FeeConfigurationCreateRequest,
    FeeConfigurationResponse,
    MultiDayScheduleReplaceRequest,
    ScheduleDefinitionResponse,
    ScheduleOverviewResponse,
    SchedulePreviewImpactRequest,
    SchedulePreviewImpactResponse,
    ScheduleReplaceRequest,
    SessionOccurrenceResponse,
    SmartScheduleApplyRequest,
    WeeklyScheduleResponse,
)
from app.modules.scheduling.service import SchedulingService

router = APIRouter(tags=["scheduling"])


def _can_view_availability(context: AuthContext) -> AuthContext:
    ensure_password_ready(context)
    allowed = {"appointment.create", "appointment.read", "schedule.manage"}
    if not allowed.intersection(context.permissions):
        from app.core.errors import AppError

        raise AppError(
            code="PERMISSION_DENIED",
            message="You don't have permission to view availability.",
            status_code=403,
        )
    return context


@router.get("/doctors/{doctor_id}/schedule", response_model=WeeklyScheduleResponse)
def get_schedule(
    doctor_id: UUID,
    effective_on: date | None = Query(default=None),
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> WeeklyScheduleResponse:
    _can_view_availability(context)
    return SchedulingService(db, clock, context).weekly_schedule(doctor_id, effective_on)


@router.get("/doctors/{doctor_id}/schedule/overview", response_model=ScheduleOverviewResponse)
def get_schedule_overview(
    doctor_id: UUID,
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> ScheduleOverviewResponse:
    _can_view_availability(context)
    return SchedulingService(db, clock, context).schedule_overview(doctor_id)


@router.post(
    "/doctors/{doctor_id}/schedule/preview-impact",
    response_model=SchedulePreviewImpactResponse,
)
def preview_schedule_impact(
    doctor_id: UUID,
    request: SchedulePreviewImpactRequest,
    context: AuthContext = Depends(require_permission("schedule.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> SchedulePreviewImpactResponse:
    return SchedulingService(db, clock, context).preview_schedule_impact(doctor_id, request)


@router.put(
    "/doctors/{doctor_id}/schedule/smart-apply",
    response_model=ScheduleOverviewResponse,
)
def smart_apply_schedule(
    doctor_id: UUID,
    request: SmartScheduleApplyRequest,
    context: AuthContext = Depends(require_permission("schedule.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> ScheduleOverviewResponse:
    with db.begin():
        return SchedulingService(db, clock, context).smart_apply_schedule(doctor_id, request)


@router.put(
    "/doctors/{doctor_id}/schedule", response_model=list[ScheduleDefinitionResponse]
)
def replace_multiple_weekdays_schedule(
    doctor_id: UUID,
    request: MultiDayScheduleReplaceRequest,
    context: AuthContext = Depends(require_permission("schedule.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> list[ScheduleDefinitionResponse]:
    with db.begin():
        return SchedulingService(db, clock, context).replace_multiple_weekdays(
            doctor_id, request
        )


@router.put(
    "/doctors/{doctor_id}/schedule/{weekday}", response_model=ScheduleDefinitionResponse
)
def replace_weekday_schedule(
    doctor_id: UUID,
    weekday: int,
    request: ScheduleReplaceRequest,
    context: AuthContext = Depends(require_permission("schedule.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> ScheduleDefinitionResponse:
    with db.begin():
        return SchedulingService(db, clock, context).replace_weekday(doctor_id, weekday, request)


@router.post("/session-occurrences/block", response_model=SessionOccurrenceResponse)
def block_session(
    request: BlockSessionRequest,
    context: AuthContext = Depends(require_permission("session.block")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> SessionOccurrenceResponse:
    with db.begin():
        return SchedulingService(db, clock, context).block(request)


@router.post(
    "/session-occurrences/{occurrence_id}/unblock", response_model=SessionOccurrenceResponse
)
def unblock_session(
    occurrence_id: UUID,
    context: AuthContext = Depends(require_permission("session.block")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> SessionOccurrenceResponse:
    with db.begin():
        return SchedulingService(db, clock, context).unblock(occurrence_id)


@router.get("/fee-configurations/current", response_model=FeeConfigurationResponse)
def current_fee_configuration(
    as_of: date | None = Query(default=None),
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> FeeConfigurationResponse:
    ensure_password_ready(context)
    allowed = {"appointment.create", "appointment.read", "fee.manage"}
    if not allowed.intersection(context.permissions):
        from app.core.errors import AppError

        raise AppError("PERMISSION_DENIED", "You don't have permission to view fees.", 403)
    return SchedulingService(db, clock, context).current_fee(as_of)


@router.post("/fee-configurations", response_model=FeeConfigurationResponse, status_code=201)
def create_fee_configuration(
    request: FeeConfigurationCreateRequest,
    context: AuthContext = Depends(require_permission("fee.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> FeeConfigurationResponse:
    with db.begin():
        return SchedulingService(db, clock, context).create_fee_configuration(request)
