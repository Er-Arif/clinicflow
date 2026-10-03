from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.db.session import get_db
from app.modules.identity.dependencies import require_permission
from app.modules.identity.service import AuthContext
from app.modules.reporting.schemas import (
    AppointmentReportResponse,
    AssistantHomeResponse,
    AuditEventListResponse,
    AuditEventResponse,
    DoctorTodayResponse,
    FollowUpReportResponse,
    OwnerDashboardResponse,
    PatientOperationalSummaryResponse,
    PatientReportResponse,
    PaymentReportResponse,
)
from app.modules.reporting.service import ReportingService

router = APIRouter(tags=["reporting"])


@router.get("/home/assistant", response_model=AssistantHomeResponse)
def assistant_home(
    context: AuthContext = Depends(require_permission("appointment.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AssistantHomeResponse:
    return ReportingService(db, clock, context).assistant_home()


@router.get("/doctor/today", response_model=DoctorTodayResponse)
def doctor_today(
    date_: date | None = Query(default=None, alias="date"),
    context: AuthContext = Depends(require_permission("appointment.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> DoctorTodayResponse:
    return ReportingService(db, clock, context).doctor_today(date_)


@router.get("/patients/{patient_id}/operational-summary", response_model=PatientOperationalSummaryResponse)
def patient_operational_summary(
    patient_id: UUID,
    history_limit: int = Query(default=30, ge=1, le=100),
    context: AuthContext = Depends(require_permission("patient.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PatientOperationalSummaryResponse:
    return ReportingService(db, clock, context).patient_summary(patient_id, history_limit=history_limit)


@router.get("/dashboard/owner", response_model=OwnerDashboardResponse)
def owner_dashboard(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    context: AuthContext = Depends(require_permission("reports.view")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> OwnerDashboardResponse:
    return ReportingService(db, clock, context).owner_dashboard(date_from, date_to)


@router.get("/reports/appointments", response_model=AppointmentReportResponse)
def appointment_report(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    context: AuthContext = Depends(require_permission("reports.view")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AppointmentReportResponse:
    return ReportingService(db, clock, context).appointment_report(date_from, date_to)


@router.get("/reports/patients", response_model=PatientReportResponse)
def patient_report(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    context: AuthContext = Depends(require_permission("reports.view")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PatientReportResponse:
    return ReportingService(db, clock, context).patient_report(date_from, date_to)


@router.get("/reports/followups", response_model=FollowUpReportResponse)
def followup_report(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    context: AuthContext = Depends(require_permission("reports.view")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> FollowUpReportResponse:
    return ReportingService(db, clock, context).followup_report(date_from, date_to)


@router.get("/reports/payments", response_model=PaymentReportResponse)
def payment_report(
    date_from: date = Query(alias="from"),
    date_to: date = Query(alias="to"),
    context: AuthContext = Depends(require_permission("reports.view")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PaymentReportResponse:
    return ReportingService(db, clock, context).payment_report(date_from, date_to)


@router.get("/audit-events", response_model=AuditEventListResponse)
def audit_events(
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    actor_user_id: UUID | None = Query(default=None),
    action_type: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    context: AuthContext = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AuditEventListResponse:
    return ReportingService(db, clock, context).audit_events(
        date_from=date_from,
        date_to=date_to,
        actor_user_id=actor_user_id,
        action_type=action_type,
        entity_type=entity_type,
        limit=limit,
        offset=offset,
    )


@router.get("/audit-events/{audit_id}", response_model=AuditEventResponse)
def audit_event_detail(
    audit_id: UUID,
    context: AuthContext = Depends(require_permission("audit.view")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> AuditEventResponse:
    return ReportingService(db, clock, context).audit_event(audit_id)
