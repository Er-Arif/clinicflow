from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class DoctorResponse(BaseModel):
    doctor_id: UUID
    display_name: str
    professional_display_details: str | None
    active: bool


class ClinicTimeResponse(BaseModel):
    clinic_date: date
    clinic_now: datetime
    timezone: str


class ClinicSettingsResponse(BaseModel):
    clinic_id: UUID
    clinic_name: str
    address: str | None
    contact_number: str | None
    version: int


class ClinicSettingsUpdateRequest(BaseModel):
    expected_version: int = Field(ge=1)
    clinic_name: str | None = Field(default=None, min_length=1, max_length=160)
    address: str | None = Field(default=None, max_length=1000)
    contact_number: str | None = Field(default=None, max_length=32)


class DoctorSettingsResponse(BaseModel):
    doctor_id: UUID
    user_id: UUID | None
    display_name: str
    professional_display_details: str | None
    active: bool
    version: int


class DoctorSettingsUpdateRequest(BaseModel):
    expected_version: int = Field(ge=1)
    display_name: str | None = Field(default=None, min_length=1, max_length=160)
    professional_display_details: str | None = Field(default=None, max_length=255)
