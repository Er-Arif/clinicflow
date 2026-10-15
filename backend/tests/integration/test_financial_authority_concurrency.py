"""CF-04/CF-07: real PostgreSQL wait graphs, domain outcomes, and rollback."""

import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import timedelta
from queue import Queue
from threading import Barrier, Event
from time import monotonic, sleep
from uuid import uuid4

import pytest
from sqlalchemy import event, func, inspect, select, text

from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.appointments.schemas import AppointmentCancelRequest
from app.modules.appointments.service import AppointmentService
from app.modules.audit.models import AuditEvent
from app.modules.audit.service import AuditService
from app.modules.followups.schemas import VisitCompleteRequest
from app.modules.idempotency.models import IdempotencyRecord
from app.modules.identity.admin_schemas import UserCreateRequest, UserUpdateRequest
from app.modules.identity.admin_service import UserAdminService
from app.modules.identity.models import AuthSession, Role, User, UserRole
from app.modules.patients.models import NumberCounter
from app.modules.payments.models import Payment, Receipt
from app.modules.payments.schemas import PaymentConfirmRequest, PaymentVoidRequest
from app.modules.payments.service import PaymentService
from app.modules.visits.models import Visit
from app.modules.visits.service import VisitService
from tests.integration.test_effective_occupancy import Scenario
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


def _transaction(scenario, operation, *, role=None, pids=None):
    def run():
        try:
            with scenario.factory.begin() as db:
                connection = db.connection()
                connection.info["race_role"] = role
                try:
                    db.execute(text("SET LOCAL lock_timeout = '8s'"))
                    db.execute(text("SET LOCAL statement_timeout = '10s'"))
                    if pids is not None:
                        pids.put(db.scalar(text("SELECT pg_backend_pid()")))
                    result = operation(db)
                finally:
                    connection.info.pop("race_role", None)
            return "ok", result
        except AppError as exc:
            return "error", exc.code

    return _run_with_request_id(run)


def _race(scenario, first, second, *, authority=False):
    """Pause after a real lock; prove the other backend waits before releasing it.

    Before CF-04 this yields P->V / V->P or A->V / V->A deadlocks.
    After correction the waiter blocks on A before it can acquire V or P.
    CF-07 uses the same proof on the clinic authority row.
    """
    engine = scenario.factory.kw["bind"]
    held, release = Event(), Event()
    first_pids, second_pids = Queue(), Queue()

    def pause(connection, cursor, statement, parameters, context, executemany):
        target = (
            "FROM clinics" in statement and "FOR NO KEY UPDATE" in statement
            if authority else
            "FOR UPDATE" in statement
            and any(f"FROM {table}" in statement for table in ("appointments", "visits", "payments"))
        )
        if connection.info.get("race_role") == "first" and target and not held.is_set():
            held.set()
            assert release.wait(10), "Controller did not release the first transaction"

    event.listen(engine, "after_cursor_execute", pause)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            one = pool.submit(_transaction, scenario, first, role="first", pids=first_pids)
            try:
                assert held.wait(5), "First transaction did not acquire its expected lock"
                first_pid = first_pids.get(timeout=1)
                two = pool.submit(_transaction, scenario, second, role="second", pids=second_pids)
                second_pid = second_pids.get(timeout=5)
                assert first_pid != second_pid
                deadline = monotonic() + 5
                with engine.connect() as observer:
                    while True:
                        blockers = observer.scalar(
                            text("SELECT pg_blocking_pids(:pid)"), {"pid": second_pid}
                        )
                        if first_pid in blockers:
                            break
                        assert not two.done(), "Second transaction did not participate in the lock"
                        assert monotonic() < deadline, "Expected PostgreSQL wait was not observed"
                        sleep(0.01)
                release.set()
                return one.result(timeout=12), two.result(timeout=12)
            finally:
                release.set()
    finally:
        event.remove(engine, "after_cursor_execute", pause)


def _checked_in(scenario):
    appointment = scenario.book()
    result = scenario.run(lambda db: VisitService(db, scenario.clock, scenario.context).check_in(
        appointment.appointment_id, idempotency_key=str(uuid4())
    ))
    return appointment.appointment_id, result.visit.visit_id, result.payment.payment_id


def _operations(scenario, ids):
    appointment_id, visit_id, payment_id = ids
    return {
        "confirm": lambda db: PaymentService(db, scenario.clock, scenario.context).confirm(
            payment_id, PaymentConfirmRequest(payment_method="CASH"), idempotency_key=str(uuid4())
        ),
        "complete": lambda db: VisitService(db, scenario.clock, scenario.context).complete(
            visit_id, VisitCompleteRequest(), idempotency_key=str(uuid4())
        ),
        "cancel": lambda db: AppointmentService(db, scenario.clock, scenario.context).cancel(
            appointment_id, AppointmentCancelRequest(reason="PATIENT_CANCELLED")
        ),
        "void": lambda db: PaymentService(db, scenario.clock, scenario.context).void(
            payment_id, PaymentVoidRequest(reason="Correction", create_replacement_payment=True),
            idempotency_key=str(uuid4())
        ),
    }


def _states(scenario, ids):
    with scenario.factory() as db:
        return tuple(db.get(model, key).status for model, key in zip(
            (Appointment, Visit, Payment), ids, strict=True
        ))


@pytest.mark.parametrize("first,second", [
    ("confirm", "complete"), ("complete", "confirm"),
    ("cancel", "complete"), ("complete", "cancel"),
    ("confirm", "cancel"), ("cancel", "confirm"),
    ("void", "complete"), ("complete", "void"),
])
def test_financial_lifecycle_both_orders(scenario, first, second):
    ids = _checked_in(scenario)
    operations = _operations(scenario, ids)
    if "void" in (first, second):
        scenario.run(operations["confirm"])
    outcomes = _race(scenario, operations[first], operations[second])
    assert outcomes[0][0] == "ok"
    if first == "cancel":
        expected_error = "VISIT_INVALID_STATE" if second == "complete" else "PAYMENT_INVALID_STATE"
        assert outcomes[1] == ("error", expected_error)
        assert _states(scenario, ids) == ("CANCELLED", "ABORTED", "CANCELLED")
    elif second == "cancel" and first == "complete":
        assert outcomes[1] == ("error", "APPOINTMENT_INVALID_STATE")
        assert _states(scenario, ids) == ("COMPLETED", "COMPLETED", "PENDING")
    else:
        assert outcomes[1][0] == "ok"
        expected = ("CANCELLED", "ABORTED") if second == "cancel" else ("COMPLETED", "COMPLETED")
        assert _states(scenario, ids) == (*expected, "VOID" if "void" in (first, second) else "CONFIRMED")
    with scenario.factory() as db:
        receipts = db.scalar(select(func.count()).select_from(Receipt).where(
            Receipt.payment_id == ids[2]
        ))
        assert receipts == (0 if first == "cancel" or (first, second) == ("complete", "cancel") else 1)
        if "void" in (first, second):
            replacement = db.scalar(select(Payment).where(Payment.correction_of_payment_id == ids[2]))
            assert replacement.status == "PENDING"
            assert replacement.visit_id == ids[1]


def _snapshot(scenario, models):
    with scenario.factory() as db:
        result = {}
        for model in models:
            rows = db.scalars(select(model).where(model.clinic_id == scenario.case.clinic_id)).all()
            result[model.__name__] = sorted(
                [tuple(repr(getattr(row, attr.key)) for attr in inspect(model).column_attrs)
                 for row in rows]
            )
        return result


@pytest.mark.parametrize("operation,action", [
    ("confirm", "PAYMENT_CONFIRMED"), ("complete", "VISIT_COMPLETED"),
    ("cancel", "APPOINTMENT_CANCELLED"), ("void", "PAYMENT_VOIDED"),
])
def test_financial_failure_rolls_back_all_writes(scenario, monkeypatch, operation, action):
    ids = _checked_in(scenario)
    operations = _operations(scenario, ids)
    if operation == "void":
        scenario.run(operations["confirm"])
    models = (Appointment, Visit, Payment, Receipt, NumberCounter, AuditEvent, IdempotencyRecord)
    before = _snapshot(scenario, models)
    original = AuditService.record

    def fail_after_audit(self, **kwargs):
        result = original(self, **kwargs)
        self.db.flush()
        if kwargs["action_type"] == action:
            raise RuntimeError("Injected failure after writes")
        return result

    with monkeypatch.context() as patch:
        patch.setattr(AuditService, "record", fail_after_audit)
        with pytest.raises(RuntimeError, match="Injected failure"):
            scenario.run(operations[operation])
    assert _snapshot(scenario, models) == before
    scenario.run(operations[operation])


def _owners(scenario, count):
    def insert(db):
        role_id = db.scalar(select(Role.role_id).where(
            Role.clinic_id.is_(None), Role.role_code == "OWNER_ADMIN"
        ))
        users = []
        for index in range(count):
            user = User(
                clinic_id=scenario.case.clinic_id, display_name=f"Owner {index}",
                login_identifier=uuid4().hex, password_hash="unused", active=True, version=1,
            )
            db.add(user)
            db.flush()
            db.add(UserRole(user_id=user.user_id, role_id=role_id, assigned_by=scenario.case.user_id))
            users.append(user.user_id)
        return users
    return scenario.run(insert)


def _owner_count(scenario):
    with scenario.factory() as db:
        return db.scalar(select(func.count(User.user_id))
            .join(UserRole, UserRole.user_id == User.user_id)
            .join(Role, Role.role_id == UserRole.role_id).where(
                User.clinic_id == scenario.case.clinic_id, User.active.is_(True),
                Role.role_code == "OWNER_ADMIN", Role.active.is_(True)
            ))


def _change(scenario, user_id, *, deactivate=False, promote=False):
    # The separate actor has users.manage, allowing deactivation without self-disable.
    context = replace(scenario.context, permissions=frozenset({"users.manage"}))
    request = UserUpdateRequest(expected_version=1, **(
        {"active": False} if deactivate else
        {"role_codes": ["OWNER_ADMIN" if promote else "ASSISTANT"]}
    ))
    return lambda db: UserAdminService(db, scenario.clock, context).update(user_id, request)


@pytest.mark.parametrize("deactivations", [(False, False), (True, True), (False, True), (True, False)])
@pytest.mark.parametrize("count", [2, 3])
def test_competing_owner_removals(scenario, count, deactivations):
    owners = _owners(scenario, count)
    outcomes = _race(scenario, *[
        _change(scenario, user_id, deactivate=disable)
        for user_id, disable in zip(owners[:2], deactivations, strict=True)
    ], authority=True)
    assert outcomes[0][0] == "ok"
    if count == 2:
        assert outcomes[1] == ("error", "LAST_OWNER_ADMIN_REQUIRED")
    else:
        assert outcomes[1][0] == "ok"
    assert _owner_count(scenario) == 1


@pytest.mark.parametrize("deactivate", [False, True])
def test_only_owner_cannot_be_removed(scenario, deactivate):
    owner, = _owners(scenario, 1)
    assert _transaction(scenario, _change(scenario, owner, deactivate=deactivate)) == (
        "error", "LAST_OWNER_ADMIN_REQUIRED"
    )
    assert _owner_count(scenario) == 1


@pytest.mark.parametrize("addition_first", [True, False])
@pytest.mark.parametrize("create", [False, True])
def test_authority_addition_and_removal(scenario, addition_first, create):
    owner, = _owners(scenario, 1)
    if create:
        def addition(db):
            return UserAdminService(db, scenario.clock, scenario.context).create(
                UserCreateRequest(display_name="New owner", login_identifier=uuid4().hex,
                                  temporary_password="test-password-only", role_codes=["OWNER_ADMIN"])
            )
    else:
        addition = _change(scenario, scenario.case.user_id, promote=True)
    removal = _change(scenario, owner)
    operations = (addition, removal) if addition_first else (removal, addition)
    outcomes = _race(scenario, *operations, authority=True)
    if addition_first:
        assert all(outcome[0] == "ok" for outcome in outcomes)
        assert _owner_count(scenario) == 1
    else:
        assert outcomes[0] == ("error", "LAST_OWNER_ADMIN_REQUIRED")
        assert outcomes[1][0] == "ok"
        assert _owner_count(scenario) == 2


def test_authority_locks_are_clinic_scoped(scenario):
    other = Scenario(scenario.factory)
    one, _ = _owners(scenario, 2)
    two, _ = _owners(other, 2)
    barrier = Barrier(2, timeout=5)
    engine = scenario.factory.kw["bind"]

    def rendezvous(connection, cursor, statement, parameters, context, executemany):
        if "FROM clinics" in statement and "FOR NO KEY UPDATE" in statement:
            barrier.wait()

    event.listen(engine, "after_cursor_execute", rendezvous)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            a = pool.submit(_transaction, scenario, _change(scenario, one))
            b = pool.submit(_transaction, other, _change(other, two))
            assert a.result(timeout=12)[0] == b.result(timeout=12)[0] == "ok"
    finally:
        event.remove(engine, "after_cursor_execute", rendezvous)
    assert _owner_count(scenario) == _owner_count(other) == 1


@pytest.mark.parametrize("deactivate", [False, True])
def test_failed_authority_change_rolls_back(scenario, monkeypatch, deactivate):
    owner, _ = _owners(scenario, 2)
    with scenario.factory.begin() as db:
        db.add(AuthSession(
            clinic_id=scenario.case.clinic_id, user_id=owner,
            refresh_token_hash=uuid4().bytes + uuid4().bytes,
            expires_at=scenario.clock.now_utc() + timedelta(days=1),
        ))
    before = _snapshot(scenario, (User, AuthSession, AuditEvent))
    with scenario.factory() as db:
        roles_before = list(db.scalars(select(UserRole.role_id).where(UserRole.user_id == owner)))
    original = AuditService.record

    def fail_after_audit(self, **kwargs):
        result = original(self, **kwargs)
        self.db.flush()
        if kwargs["action_type"] == ("USER_DISABLED" if deactivate else "USER_ROLE_CHANGED"):
            raise RuntimeError("Injected authority failure")
        return result

    operation = _change(scenario, owner, deactivate=deactivate)
    with monkeypatch.context() as patch:
        patch.setattr(AuditService, "record", fail_after_audit)
        with pytest.raises(RuntimeError, match="Injected authority failure"):
            scenario.run(operation)
    assert _snapshot(scenario, (User, AuthSession, AuditEvent)) == before
    with scenario.factory() as db:
        assert list(db.scalars(select(UserRole.role_id).where(UserRole.user_id == owner))) == roles_before
    assert _owner_count(scenario) == 2
    scenario.run(operation)
    assert _owner_count(scenario) == 1
    with scenario.factory() as db:
        session = db.scalar(select(AuthSession).where(AuthSession.user_id == owner))
        assert (session.revoked_at is not None) == deactivate
