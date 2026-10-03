from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.db.session import get_db
from app.modules.identity.dependencies import require_permission
from app.modules.identity.service import AuthContext
from app.modules.messaging.schemas import (
    AppointmentMessageRequest,
    MessageTemplateResponse,
    MessageTemplateUpdateRequest,
    PrepareReminderRequest,
    PreparedMessageResponse,
    ReminderListResponse,
    ReminderResponse,
    SkipReminderRequest,
)
from app.modules.messaging.service import ReminderService

router = APIRouter(tags=["messaging"])


@router.get("/reminders", response_model=ReminderListResponse)
def list_reminders(
    due_on: date | None = Query(default=None),
    due_through: date | None = Query(default=None),
    status: str | None = Query(default=None),
    reminder_type: str | None = Query(default=None, alias="type"),
    followup_id: UUID | None = Query(default=None),
    appointment_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    context: AuthContext = Depends(require_permission("reminder.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> ReminderListResponse:
    return ReminderService(db, clock, context).list(
        due_on=due_on,
        due_through=due_through,
        status=status,
        reminder_type=reminder_type,
        followup_id=followup_id,
        appointment_id=appointment_id,
        limit=limit,
        offset=offset,
    )


@router.post("/reminders/{reminder_id}/prepare", response_model=PreparedMessageResponse)
def prepare_reminder(
    reminder_id: UUID,
    request: PrepareReminderRequest,
    context: AuthContext = Depends(require_permission("reminder.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PreparedMessageResponse:
    with db.begin():
        return ReminderService(db, clock, context).prepare(reminder_id, request.language)


@router.post("/reminders/{reminder_id}/mark-sent", response_model=ReminderResponse)
def mark_reminder_sent(
    reminder_id: UUID,
    context: AuthContext = Depends(require_permission("reminder.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> ReminderResponse:
    with db.begin():
        return ReminderService(db, clock, context).mark_sent(reminder_id)


@router.post("/reminders/{reminder_id}/skip", response_model=ReminderResponse)
def skip_reminder(
    reminder_id: UUID,
    request: SkipReminderRequest,
    context: AuthContext = Depends(require_permission("reminder.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> ReminderResponse:
    with db.begin():
        return ReminderService(db, clock, context).skip(reminder_id, request)


@router.post("/appointments/{appointment_id}/messages", response_model=PreparedMessageResponse)
def appointment_message(
    appointment_id: UUID,
    request: AppointmentMessageRequest,
    context: AuthContext = Depends(require_permission("reminder.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PreparedMessageResponse:
    with db.begin():
        return ReminderService(db, clock, context).create_appointment_message(appointment_id, request)


@router.get("/message-templates", response_model=list[MessageTemplateResponse])
def list_message_templates(
    context: AuthContext = Depends(require_permission("message_templates.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> list[MessageTemplateResponse]:
    return ReminderService(db, clock, context).templates()


@router.patch("/message-templates/{template_id}", response_model=MessageTemplateResponse)
def update_message_template(
    template_id: UUID,
    request: MessageTemplateUpdateRequest,
    context: AuthContext = Depends(require_permission("message_templates.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> MessageTemplateResponse:
    with db.begin():
        return ReminderService(db, clock, context).update_template(template_id, request)
