from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, field_validator

from app.modules.appointments.schemas import (
    AppointmentResponse,
    CapacityOverrideInput,
    FeeAdjustmentInput,
)
from app.modules.payments.schemas import PaymentSummary


class VisitResponse(BaseModel):
    visit_id: UUID
    appointment_id: UUID
    patient_id: UUID
    doctor_id: UUID
    visit_type: str
    status: str
    checked_in_at: datetime
    completed_at: datetime | None
    aborted_at: datetime | None
    payment: PaymentSummary | None


class CheckInResponse(BaseModel):
    appointment: AppointmentResponse
    visit: VisitResponse
    payment: PaymentSummary


class WalkInRequest(BaseModel):
    patient_id: UUID
    doctor_id: UUID
    session_definition_id: UUID
    appointment_type: str
    fee_adjustment: FeeAdjustmentInput | None = None
    capacity_override: CapacityOverrideInput | None = None

    @field_validator("appointment_type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        value = value.upper()
        if value not in {"REGULAR", "FOLLOW_UP"}:
            raise ValueError("Appointment type must be REGULAR or FOLLOW_UP.")
        return value
