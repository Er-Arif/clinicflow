from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.core.config import settings
from app.core.errors import AppError
from app.db.session import get_db
from app.modules.clinic.models import Doctor
from app.modules.clinic.schemas import (
    ClinicSettingsResponse,
    ClinicSettingsUpdateRequest,
    ClinicTimeResponse,
    DoctorResponse,
    DoctorSettingsResponse,
    DoctorSettingsUpdateRequest,
)
from app.modules.clinic.service import ClinicSettingsService
from app.modules.identity.dependencies import (
    ensure_password_ready,
    get_auth_context,
    require_permission,
)
from app.modules.identity.service import AuthContext

router = APIRouter(prefix="/doctors", tags=["doctors"])
context_router = APIRouter(prefix="/clinic", tags=["clinic"])


@router.get("", response_model=list[DoctorResponse])
def list_doctors(
    context: AuthContext = Depends(get_auth_context),
    db: Session = Depends(get_db),
) -> list[DoctorResponse]:
    ensure_password_ready(context)
    allowed = {
        "appointment.create",
        "appointment.read",
        "schedule.manage",
        "clinic.settings.manage",
    }
    if not allowed.intersection(context.permissions):
        raise AppError("PERMISSION_DENIED", "You don't have permission to view doctors.", 403)
    doctors = db.scalars(
        select(Doctor)
        .where(Doctor.clinic_id == context.clinic_id, Doctor.active.is_(True))
        .order_by(Doctor.display_name)
    ).all()
    return [
        DoctorResponse(
            doctor_id=item.doctor_id,
            display_name=item.display_name,
            professional_display_details=item.professional_display_details,
            active=item.active,
        )
        for item in doctors
    ]


@context_router.get("/time", response_model=ClinicTimeResponse)
def clinic_time(
    _context: AuthContext = Depends(get_auth_context),
    clock: Clock = Depends(get_clock),
) -> ClinicTimeResponse:
    return ClinicTimeResponse(
        clinic_date=clock.clinic_date(),
        clinic_now=clock.clinic_now(),
        timezone=settings.clinic_timezone,
    )


@context_router.get("/settings", response_model=ClinicSettingsResponse)
def get_clinic_settings(
    context: AuthContext = Depends(require_permission("clinic.settings.manage")),
    db: Session = Depends(get_db),
) -> ClinicSettingsResponse:
    return ClinicSettingsService(db, context).get_clinic()


@context_router.patch("/settings", response_model=ClinicSettingsResponse)
def update_clinic_settings(
    request: ClinicSettingsUpdateRequest,
    context: AuthContext = Depends(require_permission("clinic.settings.manage")),
    db: Session = Depends(get_db),
) -> ClinicSettingsResponse:
    with db.begin():
        return ClinicSettingsService(db, context).update_clinic(request)


@router.get("/{doctor_id}/settings", response_model=DoctorSettingsResponse)
def get_doctor_settings(
    doctor_id: UUID,
    context: AuthContext = Depends(require_permission("clinic.settings.manage")),
    db: Session = Depends(get_db),
) -> DoctorSettingsResponse:
    return ClinicSettingsService(db, context).get_doctor(doctor_id)


@router.patch("/{doctor_id}/settings", response_model=DoctorSettingsResponse)
def update_doctor_settings(
    doctor_id: UUID,
    request: DoctorSettingsUpdateRequest,
    context: AuthContext = Depends(require_permission("clinic.settings.manage")),
    db: Session = Depends(get_db),
) -> DoctorSettingsResponse:
    with db.begin():
        return ClinicSettingsService(db, context).update_doctor(doctor_id, request)
