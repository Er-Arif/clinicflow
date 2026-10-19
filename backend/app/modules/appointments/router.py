from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.core.errors import AppError
from app.db.session import get_db
from app.modules.appointments.availability import AppointmentAvailabilityService
from app.modules.appointments.cancellation_guard import require_payment_correction_before_cancellation
from app.modules.appointments.schemas import (
    AppointmentAdjustFeeRequest,
    AppointmentCancelRequest,
    AppointmentCreateRequest,
    AppointmentListResponse,
    AppointmentRescheduleRequest,
    AppointmentRescheduleResponse,
    AppointmentResponse,
)
from app.modules.appointments.service import AppointmentService
from app.modules.identity.dependencies import (
    ensure_password_ready,
    get_auth_context,
    require_permission,
)
from app.modules.identity.service import AuthContext
from app.modules.scheduling.schemas import AvailabilityResponse
from app.modules.visits.schemas import CheckInResponse
from app.modules.visits.service import VisitService

router = APIRouter(tags=["appointments"])


def _idempotency_key(value: str | None) -> str:
    if value is None or not value.strip():
        raise AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.", 422)
    return value.strip()


@router.get("/doctors/{doctor_id}/availability", response_model=AvailabilityResponse)
def appointment_availability(
    doctor_id: UUID,
    date_: date = Query(alias="date"),
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AvailabilityResponse:
    ensure_password_ready(context)
    if not {"appointment.create", "appointment.read", "schedule.manage"}.intersection(
        context.permissions
    ):
        raise AppError("PERMISSION_DENIED", "You don't have permission to view availability.", 403)
    return AppointmentAvailabilityService(db, clock, context).get(doctor_id, date_)


@router.get("/appointments", response_model=AppointmentListResponse)
def list_appointments(
    date_: date | None = Query(default=None, alias="date"),
    patient_id: UUID | None = Query(default=None),
    doctor_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    context: AuthContext = Depends(require_permission("appointment.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AppointmentListResponse:
    return AppointmentService(db, clock, context).list(
        target_date=date_,
        patient_id=patient_id,
        doctor_id=doctor_id,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.post("/appointments", response_model=AppointmentResponse, status_code=201)
def create_appointment(
    request: AppointmentCreateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    context: AuthContext = Depends(require_permission("appointment.create")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AppointmentResponse:
    with db.begin():
        return AppointmentService(db, clock, context).create(
            request, idempotency_key=_idempotency_key(idempotency_key)
        )


@router.get("/appointments/{appointment_id}", response_model=AppointmentResponse)
def get_appointment(
    appointment_id: UUID,
    context: AuthContext = Depends(require_permission("appointment.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AppointmentResponse:
    return AppointmentService(db, clock, context).get(appointment_id)


@router.post("/appointments/{appointment_id}/check-in", response_model=CheckInResponse)
def check_in_appointment(
    appointment_id: UUID,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    context: AuthContext = Depends(require_permission("appointment.check_in")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> CheckInResponse:
    with db.begin():
        return VisitService(db, clock, context).check_in(
            appointment_id, idempotency_key=_idempotency_key(idempotency_key)
        )


@router.post("/appointments/{appointment_id}/cancel", response_model=AppointmentResponse)
def cancel_appointment(
    appointment_id: UUID,
    request: AppointmentCancelRequest,
    context: AuthContext = Depends(require_permission("appointment.cancel")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AppointmentResponse:
    with db.begin():
        require_payment_correction_before_cancellation(db, context.clinic_id, appointment_id)
        return AppointmentService(db, clock, context).cancel(appointment_id, request)


@router.post(
    "/appointments/{appointment_id}/reschedule", response_model=AppointmentRescheduleResponse
)
def reschedule_appointment(
    appointment_id: UUID,
    request: AppointmentRescheduleRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    context: AuthContext = Depends(require_permission("appointment.reschedule")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AppointmentRescheduleResponse:
    with db.begin():
        return AppointmentService(db, clock, context).reschedule(
            appointment_id,
            request,
            idempotency_key=_idempotency_key(idempotency_key),
        )


@router.post("/appointments/{appointment_id}/adjust-fee", response_model=AppointmentResponse)
def adjust_appointment_fee(
    appointment_id: UUID,
    request: AppointmentAdjustFeeRequest,
    context: AuthContext = Depends(require_permission("appointment.create")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AppointmentResponse:
    with db.begin():
        return AppointmentService(db, clock, context).adjust_fee(appointment_id, request)
