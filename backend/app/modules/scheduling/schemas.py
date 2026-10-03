from __future__ import annotations

from datetime import date, time
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class SessionWrite(BaseModel):
    session_name: str = Field(min_length=1, max_length=80)
    start_time: time
    end_time: time
    slot_interval_minutes: int = Field(gt=0, le=240)
    maximum_capacity: int = Field(gt=0, le=500)
    active: bool = True
    display_order: int = Field(default=0, ge=0, le=100)

    @model_validator(mode="after")
    def validate_session(self) -> SessionWrite:
        if self.end_time <= self.start_time:
            raise ValueError("Session end time must be later than start time.")
        if self.maximum_capacity > generated_slot_count(
            self.start_time, self.end_time, self.slot_interval_minutes
        ):
            raise ValueError("Maximum capacity cannot exceed the number of generated slots.")
        return self


class ScheduleReplaceRequest(BaseModel):
    effective_from: date
    sessions: list[SessionWrite] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def validate_orders(self) -> ScheduleReplaceRequest:
        orders = [session.display_order for session in self.sessions]
        if len(orders) != len(set(orders)):
            raise ValueError("Session display order must be unique within a weekday.")
        return self


class SessionDefinitionResponse(BaseModel):
    session_definition_id: UUID
    session_name: str
    start_time: time
    end_time: time
    slot_interval_minutes: int
    maximum_capacity: int
    active: bool
    display_order: int


class ScheduleDefinitionResponse(BaseModel):
    schedule_definition_id: UUID
    doctor_id: UUID
    weekday: int
    effective_from: date
    effective_to: date | None
    active: bool
    version: int
    sessions: list[SessionDefinitionResponse]


class WeeklyScheduleResponse(BaseModel):
    doctor_id: UUID
    effective_on: date
    days: list[ScheduleDefinitionResponse]


class AvailabilitySlot(BaseModel):
    time: time
    available: bool
    normal_booking_allowed: bool


class AvailabilitySession(BaseModel):
    session_occurrence_id: UUID | None
    session_definition_id: UUID
    materialized: bool
    name: str
    start_time: time
    end_time: time
    status: str
    slot_interval_minutes: int
    maximum_capacity: int
    used_capacity: int
    remaining_capacity: int
    slots: list[AvailabilitySlot]
    blocked_reason: str | None = None


class AvailabilityResponse(BaseModel):
    doctor_id: UUID
    date: date
    sessions: list[AvailabilitySession]


class BlockSessionRequest(BaseModel):
    session_definition_id: UUID
    date: date
    reason: str = Field(min_length=2, max_length=500)


class SessionOccurrenceResponse(BaseModel):
    session_occurrence_id: UUID
    session_definition_id: UUID
    doctor_id: UUID
    date: date
    name: str
    start_time: time
    end_time: time
    slot_interval_minutes: int
    maximum_capacity: int
    status: str
    block_reason: str | None
    version: int


class FeeConfigurationCreateRequest(BaseModel):
    effective_from: date
    regular_fee: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    followup_fee: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    assistant_adjustment_allowed: bool = False

    @field_validator("regular_fee", "followup_fee")
    @classmethod
    def normalize_money(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.01"))


class FeeConfigurationResponse(BaseModel):
    fee_configuration_id: UUID
    effective_from: date
    effective_to: date | None
    regular_fee: Decimal
    followup_fee: Decimal
    assistant_adjustment_allowed: bool


def generated_slot_count(start: time, end: time, interval_minutes: int) -> int:
    start_minutes = start.hour * 60 + start.minute + start.second / 60
    end_minutes = end.hour * 60 + end.minute + end.second / 60
    return int((end_minutes - start_minutes) // interval_minutes)
