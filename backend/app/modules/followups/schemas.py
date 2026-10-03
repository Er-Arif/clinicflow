from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.modules.appointments.schemas import AppointmentResponse, CapacityOverrideInput


class FollowUpCreateInput(BaseModel):
    interval_days: int | None = Field(default=None, ge=1, le=3650)
    due_date: date | None = None

    @model_validator(mode="after")
    def exactly_one_due_method(self) -> "FollowUpCreateInput":
        if (self.interval_days is None) == (self.due_date is None):
            raise ValueError("Provide either interval_days or due_date.")
        return self


class VisitCompleteRequest(BaseModel):
    follow_up: FollowUpCreateInput | None = None


class FollowUpPatientSummary(BaseModel):
    patient_id: UUID
    patient_code: str
    full_name: str
    mobile_number: str


class FollowUpLinkedAppointmentSummary(BaseModel):
    appointment_id: UUID
    date: date
    time: time | None
    status: str


class FollowUpResponse(BaseModel):
    followup_id: UUID
    patient: FollowUpPatientSummary
    source_visit_id: UUID
    source_visit_date: date
    doctor_id: UUID
    due_date: date
    interval_days: int | None
    status: str
    overdue: bool
    linked_appointment: FollowUpLinkedAppointmentSummary | None
    close_reason: str | None
    version: int
    created_at: datetime
    closed_at: datetime | None


class FollowUpListResponse(BaseModel):
    items: list[FollowUpResponse]
    total: int
    limit: int
    offset: int


class FollowUpBookRequest(BaseModel):
    session_definition_id: UUID
    appointment_date: date
    appointment_time: time
    capacity_override: CapacityOverrideInput | None = None


class FollowUpBookResponse(BaseModel):
    followup: FollowUpResponse
    appointment: AppointmentResponse


class FollowUpCloseRequest(BaseModel):
    reason: str
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_reason(self) -> "FollowUpCloseRequest":
        self.reason = self.reason.upper()
        allowed = {"PATIENT_DECLINED", "NO_LONGER_REQUIRED", "CONTACTED", "OTHER"}
        if self.reason not in allowed:
            raise ValueError("Invalid follow-up closure reason.")
        if self.reason == "OTHER" and not (self.note or "").strip():
            raise ValueError("Enter a note when closure reason is OTHER.")
        return self


class VisitCompletionResponse(BaseModel):
    appointment: AppointmentResponse
    visit_id: UUID
    visit_status: str
    completed_at: datetime
    payment_status: str | None
    followup: FollowUpResponse | None
    closed_previous_followup_id: UUID | None = None
