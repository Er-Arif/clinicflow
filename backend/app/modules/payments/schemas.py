import re
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class PaymentSummary(BaseModel):
    payment_id: UUID
    visit_id: UUID
    amount_due: Decimal
    amount_paid: Decimal | None
    payment_method: str | None
    status: str
    created_at: datetime


class PaymentResponse(PaymentSummary):
    patient_id: UUID
    patient_code: str
    patient_name: str
    visit_date: date
    appointment_type: str
    confirmation_source: str | None
    confirmed_by: UUID | None
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    cancel_reason: str | None
    voided_at: datetime | None
    void_reason: str | None
    correction_of_payment_id: UUID | None
    receipt_number: str | None


class PaymentListResponse(BaseModel):
    items: list[PaymentResponse]
    total: int
    limit: int
    offset: int


class PaymentConfirmRequest(BaseModel):
    payment_method: str

    @field_validator("payment_method")
    @classmethod
    def validate_method(cls, value: str) -> str:
        value = value.upper()
        if value not in {"CASH", "UPI"}:
            raise ValueError("Payment method must be CASH or UPI.")
        return value


class PaymentVoidRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=500)
    create_replacement_payment: bool = False


class PaymentVoidResponse(BaseModel):
    voided: PaymentResponse
    replacement: PaymentResponse | None


class ReceiptResponse(BaseModel):
    receipt_id: UUID
    payment_id: UUID
    receipt_number: str
    issued_at: datetime
    clinic_name: str
    doctor_name: str
    patient_name: str
    appointment_type: str
    visit_date: date
    amount: Decimal
    payment_method: str
    voided: bool


class UpiConfigurationResponse(BaseModel):
    upi_configuration_id: UUID
    upi_id: str
    payee_name: str
    active: bool
    version: int
    updated_at: datetime


class UpiConfigurationUpdateRequest(BaseModel):
    upi_id: str = Field(min_length=3, max_length=120)
    payee_name: str = Field(min_length=1, max_length=160)
    active: bool = True
    expected_version: int | None = Field(default=None, ge=1)

    @field_validator("upi_id")
    @classmethod
    def validate_upi_id(cls, value: str) -> str:
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9._+-]+@[A-Za-z0-9._-]+", value):
            raise ValueError("Enter a valid UPI ID.")
        return value

    @field_validator("payee_name")
    @classmethod
    def normalize_payee_name(cls, value: str) -> str:
        return value.strip()


class PaymentConfirmationResponse(BaseModel):
    payment: PaymentResponse
    receipt: ReceiptResponse


class UpiIntentResponse(BaseModel):
    payment_id: UUID
    amount: Decimal
    upi_id: str
    payee_name: str
    transaction_reference: str
    note: str
    upi_uri: str
