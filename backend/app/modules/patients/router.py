from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.db.session import get_db
from app.modules.identity.dependencies import require_permission
from app.modules.identity.service import AuthContext
from app.modules.patients.schemas import (
    PatientCreateRequest,
    PatientListResponse,
    PatientResponse,
    PatientTimelineResponse,
    PatientUpdateRequest,
)
from app.modules.patients.service import PatientService

router = APIRouter(prefix="/patients", tags=["patients"])


@router.get("", response_model=PatientListResponse)
def search_patients(
    q: str = Query(default="", max_length=160),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    context: AuthContext = Depends(require_permission("patient.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PatientListResponse:
    return PatientService(db, clock, context).search(query=q, limit=limit, offset=offset)


@router.post("", response_model=PatientResponse, status_code=201)
def create_patient(
    request: PatientCreateRequest,
    context: AuthContext = Depends(require_permission("patient.create")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PatientResponse:
    with db.begin():
        return PatientService(db, clock, context).create(request)


@router.get("/{patient_id}", response_model=PatientResponse)
def get_patient(
    patient_id: UUID,
    context: AuthContext = Depends(require_permission("patient.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PatientResponse:
    return PatientService(db, clock, context).get(patient_id)


@router.patch("/{patient_id}", response_model=PatientResponse)
def update_patient(
    patient_id: UUID,
    request: PatientUpdateRequest,
    context: AuthContext = Depends(require_permission("patient.edit")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PatientResponse:
    with db.begin():
        return PatientService(db, clock, context).update(patient_id, request)


@router.get("/{patient_id}/timeline", response_model=PatientTimelineResponse)
def patient_timeline(
    patient_id: UUID,
    context: AuthContext = Depends(require_permission("patient.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PatientTimelineResponse:
    return PatientService(db, clock, context).timeline(patient_id)
