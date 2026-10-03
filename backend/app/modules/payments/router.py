from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.core.errors import AppError
from app.db.session import get_db
from app.modules.identity.dependencies import require_permission
from app.modules.identity.service import AuthContext
from app.modules.payments.schemas import (
    PaymentConfirmationResponse,
    PaymentConfirmRequest,
    PaymentListResponse,
    PaymentResponse,
    PaymentVoidRequest,
    PaymentVoidResponse,
    ReceiptResponse,
    UpiConfigurationResponse,
    UpiConfigurationUpdateRequest,
    UpiIntentResponse,
)
from app.modules.payments.service import PaymentService

router = APIRouter(tags=["payments"])


def _idempotency_key(value: str | None) -> str:
    if value is None or not value.strip():
        raise AppError("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required.", 422)
    return value.strip()


@router.get("/payments", response_model=PaymentListResponse)
def list_payments(
    status: str | None = Query(default=None),
    date_: date | None = Query(default=None, alias="date"),
    patient_id: UUID | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    context: AuthContext = Depends(require_permission("payment.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PaymentListResponse:
    return PaymentService(db, clock, context).list(
        status=status,
        target_date=date_,
        patient_id=patient_id,
        limit=limit,
        offset=offset,
    )


@router.get("/payments/{payment_id}", response_model=PaymentResponse)
def get_payment(
    payment_id: UUID,
    context: AuthContext = Depends(require_permission("payment.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PaymentResponse:
    return PaymentService(db, clock, context).get(payment_id)


@router.post("/payments/{payment_id}/confirm", response_model=PaymentConfirmationResponse)
def confirm_payment(
    payment_id: UUID,
    request: PaymentConfirmRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    context: AuthContext = Depends(require_permission("payment.confirm")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PaymentConfirmationResponse:
    with db.begin():
        return PaymentService(db, clock, context).confirm(
            payment_id,
            request,
            idempotency_key=_idempotency_key(idempotency_key),
        )


@router.post("/payments/{payment_id}/void", response_model=PaymentVoidResponse)
def void_payment(
    payment_id: UUID,
    request: PaymentVoidRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    context: AuthContext = Depends(require_permission("payment.void")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> PaymentVoidResponse:
    with db.begin():
        return PaymentService(db, clock, context).void(
            payment_id,
            request,
            idempotency_key=_idempotency_key(idempotency_key),
        )


@router.get("/payments/{payment_id}/receipt", response_model=ReceiptResponse)
def get_receipt(
    payment_id: UUID,
    context: AuthContext = Depends(require_permission("payment.read")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> ReceiptResponse:
    return PaymentService(db, clock, context).receipt(payment_id)


@router.get("/payments/{payment_id}/upi-intent", response_model=UpiIntentResponse)
def get_upi_intent(
    payment_id: UUID,
    context: AuthContext = Depends(require_permission("payment.confirm")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> UpiIntentResponse:
    return PaymentService(db, clock, context).upi_intent(payment_id)


@router.get("/upi-configuration", response_model=UpiConfigurationResponse)
def get_upi_configuration(
    context: AuthContext = Depends(require_permission("upi.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> UpiConfigurationResponse:
    return PaymentService(db, clock, context).get_upi_configuration()


@router.patch("/upi-configuration", response_model=UpiConfigurationResponse)
def update_upi_configuration(
    request: UpiConfigurationUpdateRequest,
    context: AuthContext = Depends(require_permission("upi.manage")),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> UpiConfigurationResponse:
    with db.begin():
        return PaymentService(db, clock, context).update_upi_configuration(request)
