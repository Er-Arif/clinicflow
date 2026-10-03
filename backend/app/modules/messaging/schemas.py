from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class ReminderResponse(BaseModel):
    reminder_id: UUID
    patient_id: UUID
    patient_name: str
    whatsapp_number: str
    appointment_id: UUID | None
    followup_id: UUID | None
    reminder_type: str
    channel: str
    language: str
    due_on: date
    due_at: datetime | None
    status: str
    message_snapshot: str | None
    sent_at: datetime | None
    skipped_at: datetime | None
    skip_reason: str | None
    sendable: bool
    suppression_reason: str | None


class ReminderListResponse(BaseModel):
    items: list[ReminderResponse]
    total: int
    limit: int
    offset: int


class PrepareReminderRequest(BaseModel):
    language: str | None = None

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.upper()
        if value not in {"EN", "HI"}:
            raise ValueError("Language must be EN or HI.")
        return value


class PreparedMessageResponse(BaseModel):
    reminder: ReminderResponse
    rendered_message: str
    whatsapp_url: str


class SkipReminderRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=100)


class AppointmentMessageRequest(BaseModel):
    message_type: str
    language: str | None = None

    @field_validator("message_type")
    @classmethod
    def validate_type(cls, value: str) -> str:
        value = value.upper()
        if value not in {"APPOINTMENT_CONFIRMATION", "APPOINTMENT_CANCELLED", "APPOINTMENT_RESCHEDULED"}:
            raise ValueError("Unsupported appointment message type.")
        return value

    @field_validator("language")
    @classmethod
    def validate_language(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.upper()
        if value not in {"EN", "HI"}:
            raise ValueError("Language must be EN or HI.")
        return value


class MessageTemplateResponse(BaseModel):
    template_id: UUID
    template_type: str
    language: str
    template_body: str
    active: bool
    version: int
    updated_at: datetime


class MessageTemplateUpdateRequest(BaseModel):
    template_body: str = Field(min_length=1, max_length=4000)
    active: bool = True
    expected_version: int = Field(ge=1)
