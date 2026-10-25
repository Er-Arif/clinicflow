import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.core.errors import AppError
from app.modules.payments.models import Payment
from app.modules.payments.schemas import PaymentConfirmRequest, PaymentVoidRequest
from app.modules.payments.service import PaymentService
from tests.integration.test_effective_occupancy import Scenario
from tests.integration.test_financial_authority_concurrency import _checked_in
from tests.integration.test_transaction_concurrency import _run_with_request_id, _session_factory

pytestmark = pytest.mark.skipif(
    os.getenv("CLINICFLOW_RUN_INTEGRATION") != "1", reason="Requires migrated PostgreSQL."
)


@pytest.fixture
def scenario():
    factory, engine = _session_factory()
    try:
        yield Scenario(factory)
    finally:
        engine.dispose()


def _confirmed_payment(scenario: Scenario):
    _appointment_id, _visit_id, payment_id = _checked_in(scenario)
    scenario.run(
        lambda db: PaymentService(db, scenario.clock, scenario.context).confirm(
            payment_id,
            PaymentConfirmRequest(payment_method="CASH"),
            idempotency_key=str(uuid4()),
        )
    )
    return payment_id


def _replacement_count(scenario: Scenario, payment_id):
    with scenario.factory() as db:
        return db.scalar(
            select(func.count(Payment.payment_id)).where(
                Payment.clinic_id == scenario.case.clinic_id,
                Payment.correction_of_payment_id == payment_id,
            )
        )


def test_same_void_idempotency_key_replays_one_replacement(scenario):
    payment_id = _confirmed_payment(scenario)
    key = str(uuid4())
    request = PaymentVoidRequest(reason="Correction", create_replacement_payment=True)

    def void_once():
        return scenario.run(
            lambda db: PaymentService(db, scenario.clock, scenario.context).void(
                payment_id,
                request,
                idempotency_key=key,
            )
        )

    first = void_once()
    second = void_once()

    assert first.voided.payment_id == second.voided.payment_id == payment_id
    assert first.replacement is not None
    assert second.replacement is not None
    assert first.replacement.payment_id == second.replacement.payment_id
    assert _replacement_count(scenario, payment_id) == 1


def test_concurrent_void_intents_create_one_replacement(scenario):
    payment_id = _confirmed_payment(scenario)
    barrier = Barrier(2)

    def worker(key: str):
        barrier.wait()
        try:
            def operation():
                with scenario.factory.begin() as db:
                    return PaymentService(db, scenario.clock, scenario.context).void(
                        payment_id,
                        PaymentVoidRequest(
                            reason="Correction",
                            create_replacement_payment=True,
                        ),
                        idempotency_key=key,
                    )

            result = _run_with_request_id(operation)
            return "ok", result.replacement.payment_id if result.replacement else None
        except AppError as exc:
            return "error", exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(
            pool.map(worker, [str(uuid4()), str(uuid4())])
        )

    assert sum(outcome[0] == "ok" for outcome in outcomes) == 1
    assert ("error", "PAYMENT_INVALID_STATE") in outcomes
    assert _replacement_count(scenario, payment_id) == 1

    with scenario.factory() as db:
        original = db.get(Payment, payment_id)
        replacement = db.scalar(
            select(Payment).where(
                Payment.clinic_id == scenario.case.clinic_id,
                Payment.correction_of_payment_id == payment_id,
            )
        )
        assert original is not None and original.status == "VOID"
        assert replacement is not None and replacement.status == "PENDING"
