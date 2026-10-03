from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class FeeAdjustmentInput(BaseModel):
    amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    reason: str = Field(min_length=2, max_length=500)

    @field_validator("amount")
    @classmethod
    def normalize_money(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class CapacityOverrideInput(BaseModel):
    enabled: bool = True
    reason: str = Field(min_length=2, max_length=500)


class AppointmentCreateRequest(BaseModel):
    patient_id: UUID
    doctor_id: UUID
    # Lazy occurrence materialization requires definition + date when availability
    # has not yet persisted an occurrence. This is the authoritative M4 create path.
    session_definition_id: UUID
    appointment_date: date
    appointment_time: time
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


class AppointmentCancelRequest(BaseModel):
    reason: str
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_reason(self) -> AppointmentCancelRequest:
        allowed = {"PATIENT_CANCELLED", "NO_SHOW", "DOCTOR_UNAVAILABLE", "OTHER"}
        self.reason = self.reason.upper()
        if self.reason not in allowed:
            raise ValueError("Invalid cancellation reason.")
        if self.reason == "OTHER" and not (self.note or "").strip():
            raise ValueError("Enter a note when cancellation reason is OTHER.")
        return self


class AppointmentRescheduleRequest(BaseModel):
    new_session_definition_id: UUID
    new_appointment_date: date
    new_appointment_time: time
    capacity_override: CapacityOverrideInput | None = None


class AppointmentAdjustFeeRequest(BaseModel):
    amount: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    reason: str = Field(min_length=2, max_length=500)

    @field_validator("amount")
    @classmethod
    def normalize_money(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class AppointmentPatientSummary(BaseModel):
    patient_id: UUID
    patient_code: str
    full_name: str
    mobile_number: str


class AppointmentDoctorSummary(BaseModel):
    doctor_id: UUID
    display_name: str


class AppointmentSessionSummary(BaseModel):
    session_occurrence_id: UUID
    session_definition_id: UUID
    date: date
    name: str
    start_time: time
    end_time: time


class AppointmentResponse(BaseModel):
    appointment_id: UUID
    patient: AppointmentPatientSummary
    doctor: AppointmentDoctorSummary
    session: AppointmentSessionSummary
    appointment_time: time | None
    appointment_type: str
    booking_source: str
    status: str
    base_fee: Decimal
    effective_fee: Decimal
    fee_adjusted: bool
    capacity_override_used: bool
    cancellation_reason: str | None
    cancellation_note: str | None
    rescheduled_from_appointment_id: UUID | None
    rescheduled_to_appointment_id: UUID | None
    reminder_eligible: bool
    visit_id: UUID | None = None
    visit_status: str | None = None
    payment_id: UUID | None = None
    payment_status: str | None = None
    linked_followup_id: UUID | None = None
    linked_followup_status: str | None = None
    version: int
    created_at: datetime


class AppointmentListResponse(BaseModel):
    items: list[AppointmentResponse]
    total: int
    limit: int
    offset: int


class AppointmentRescheduleResponse(BaseModel):
    original: AppointmentResponse
    replacement: AppointmentResponse


class FeeAdjustmentHistoryItem(BaseModel):
    fee_adjustment_id: UUID
    previous_amount: Decimal
    new_amount: Decimal
    reason: str
    adjusted_by: UUID
    adjusted_at: datetime
