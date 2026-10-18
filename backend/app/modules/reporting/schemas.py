from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel


class OperationalAppointmentItem(BaseModel):
    appointment_id: UUID
    patient_id: UUID
    patient_code: str
    patient_name: str
    appointment_time: time | None
    appointment_type: str
    status: str
    payment_status: str | None = None
    checked_in_at: datetime | None = None


class AssistantHomeResponse(BaseModel):
    clinic_date: date
    appointments: int
    booked: int
    checked_in: int
    completed: int
    cancelled: int
    pending_payments: int
    due_reminders: int
    overdue_followups: int
    next_appointments: list[OperationalAppointmentItem]
    checked_in_patients: list[OperationalAppointmentItem]


class DoctorTodayResponse(BaseModel):
    date: date
    total_appointments: int
    checked_in_count: int
    upcoming_count: int
    checked_in: list[OperationalAppointmentItem]
    upcoming: list[OperationalAppointmentItem]


class DoctorTodayDetailItem(BaseModel):
    appointment_id: UUID
    patient_id: UUID
    patient_name: str
    mobile_number: str
    gender: str
    age: int | None
    appointment_time: time | None
    appointment_type: str
    status: str


class DoctorTodayDetailsResponse(BaseModel):
    date: date
    view: str
    total: int
    items: list[DoctorTodayDetailItem]


class PatientSummaryBase(BaseModel):
    patient_id: UUID
    patient_code: str
    full_name: str
    mobile_number: str
    gender: str
    age: int | None


class UpcomingAppointmentSummary(BaseModel):
    appointment_id: UUID
    date: date
    appointment_time: time | None
    appointment_type: str
    status: str


class OpenFollowUpSummary(BaseModel):
    followup_id: UUID
    due_date: date
    overdue: bool
    status: str


class VisitHistoryItem(BaseModel):
    visit_id: UUID
    appointment_id: UUID
    date: date
    appointment_type: str
    completed_at: datetime
    payment_status: str | None = None
    followup_status: str | None = None


class PatientOperationalSummaryResponse(BaseModel):
    patient: PatientSummaryBase
    total_completed_visits: int
    last_visit_date: date | None
    upcoming_appointment: UpcomingAppointmentSummary | None
    open_followup: OpenFollowUpSummary | None
    visit_history: list[VisitHistoryItem]


class OwnerDashboardResponse(BaseModel):
    date_from: date
    date_to: date
    appointments: int
    checked_in: int
    completed: int
    cancelled: int
    no_show: int
    new_patients: int
    returning_patient_visits: int
    unique_patients: int
    followup_appointments: int
    confirmed_revenue: Decimal
    cash: Decimal
    upi: Decimal
    pending_amount: Decimal


class AppointmentReportResponse(BaseModel):
    date_from: date
    date_to: date
    total_appointments: int
    booked: int
    checked_in: int
    completed: int
    cancelled: int
    no_show: int
    rescheduled: int


class PatientReportResponse(BaseModel):
    date_from: date
    date_to: date
    new_patients: int
    returning_patient_visits: int
    unique_patients: int


class FollowUpReportResponse(BaseModel):
    date_from: date
    date_to: date
    created: int
    booked_events: int
    closed_events: int
    open_current: int
    overdue_current: int


class PaymentReportResponse(BaseModel):
    date_from: date
    date_to: date
    confirmed_total: Decimal
    cash: Decimal
    upi: Decimal
    pending: Decimal
    confirmed_transaction_count: int
    voided_payment_count: int


class AuditEventResponse(BaseModel):
    audit_id: UUID
    occurred_at: datetime
    actor_type: str
    actor_user_id: UUID | None
    actor_display_name: str | None
    action_type: str
    entity_type: str
    entity_id: UUID | None
    reason: str | None
    previous_values: dict | None
    new_values: dict | None
    metadata: dict | None
    request_id: UUID


class AuditEventListResponse(BaseModel):
    items: list[AuditEventResponse]
    total: int
    limit: int
    offset: int
