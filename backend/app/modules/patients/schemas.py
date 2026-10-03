from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class PatientCreateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    mobile_number: str = Field(min_length=10, max_length=32)
    whatsapp_same_as_mobile: bool = True
    whatsapp_number: str | None = Field(default=None, max_length=32)
    date_of_birth: date | None = None
    approximate_age_years: int | None = Field(default=None, ge=0, le=130)
    gender: str
    preferred_language: str
    reminders_enabled: bool = True
    allow_shared_mobile: bool = False

    @model_validator(mode="after")
    def validate_age_and_whatsapp(self) -> PatientCreateRequest:
        if (self.date_of_birth is None) == (self.approximate_age_years is None):
            raise ValueError("Provide either date of birth or approximate age, not both.")
        if not self.whatsapp_same_as_mobile and not self.whatsapp_number:
            raise ValueError("Enter the patient's WhatsApp number.")
        if self.gender not in {"MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"}:
            raise ValueError("Select a valid gender.")
        if self.preferred_language not in {"EN", "HI"}:
            raise ValueError("Preferred language must be EN or HI.")
        return self


class PatientUpdateRequest(BaseModel):
    expected_version: int = Field(ge=1)
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    mobile_number: str | None = Field(default=None, min_length=10, max_length=32)
    whatsapp_same_as_mobile: bool | None = None
    whatsapp_number: str | None = Field(default=None, max_length=32)
    date_of_birth: date | None = None
    approximate_age_years: int | None = Field(default=None, ge=0, le=130)
    gender: str | None = None
    preferred_language: str | None = None
    reminders_enabled: bool | None = None
    allow_shared_mobile: bool = False

    @model_validator(mode="after")
    def validate_enums(self) -> PatientUpdateRequest:
        if self.gender is not None and self.gender not in {
            "MALE",
            "FEMALE",
            "OTHER",
            "PREFER_NOT_TO_SAY",
        }:
            raise ValueError("Select a valid gender.")
        if self.preferred_language is not None and self.preferred_language not in {"EN", "HI"}:
            raise ValueError("Preferred language must be EN or HI.")
        return self


class DuplicatePatientCandidate(BaseModel):
    patient_id: UUID
    patient_code: str
    full_name: str
    mobile_number: str
    gender: str
    age: int
    last_visit_date: date | None = None
    previous_completed_visits: int = 0


class PatientResponse(BaseModel):
    patient_id: UUID
    patient_code: str
    full_name: str
    mobile_number: str
    whatsapp_number: str
    whatsapp_same_as_mobile: bool
    date_of_birth: date | None
    approximate_age_years: int | None
    age_as_of_date: date | None
    age: int
    gender: str
    preferred_language: str
    reminders_enabled: bool
    previous_completed_visits: int = 0
    last_visit_date: date | None = None
    version: int
    created_at: datetime
    updated_at: datetime


class PatientListResponse(BaseModel):
    items: list[PatientResponse]
    total: int
    limit: int
    offset: int


class PatientTimelineResponse(BaseModel):
    patient: PatientResponse
    entries: list[dict] = Field(default_factory=list)
