import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.auth_throttle import AuthThrottle
from app.core.clock import get_clock
from app.core.errors import register_exception_handlers
from app.core.middleware import RequestIdMiddleware
from app.core.security import PasswordService
from app.db.session import get_db
from app.modules.identity import router as auth_module
from app.modules.identity.models import User
from tests.integration.test_transaction_concurrency import FrozenClock, _seed_case, _session_factory

pytestmark = pytest.mark.skipif(os.getenv("CLINICFLOW_RUN_INTEGRATION") != "1", reason="Requires PostgreSQL")


def test_http_failures_are_uniform_throttled_and_success_recovers(monkeypatch):
    factory, engine = _session_factory()
    case = _seed_case(factory)
    with factory.begin() as db:
        user = db.get(User, case.user_id)
        identifier = user.login_identifier
        user.password_hash = PasswordService.hash("correct-test-password")
    now = [0.0]
    limiter = AuthThrottle(timer=lambda: now[0])
    monkeypatch.setattr(auth_module, "auth_throttle", limiter)
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)
    app.include_router(auth_module.router)
    register_exception_handlers(app)
    def database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_clock] = FrozenClock
    try:
        with TestClient(app) as client:
            def login(name, password="wrong-password"):
                return client.post("/auth/login", json={"login_identifier": name, "password": password})
            failures = [login(identifier), login("unknown-account")]
            with factory.begin() as db:
                db.get(User, case.user_id).active = False
            failures.append(login(identifier, "correct-test-password"))
            assert {r.status_code for r in failures} == {401}
            assert {r.json()["error"]["code"] for r in failures} == {"INVALID_CREDENTIALS"}
            assert len({r.json()["error"]["message"] for r in failures}) == 1
            with factory.begin() as db:
                db.get(User, case.user_id).active = True
            for _ in range(3):
                assert login(" " + identifier.upper() + " ").status_code == 401
            denied = login(identifier, "correct-test-password")
            assert denied.status_code == 429 and denied.headers["Retry-After"] == "60"
            assert denied.json()["error"]["request_id"]
            now[0] = 61
            success = login(identifier, "correct-test-password")
            assert success.status_code == 200
            assert success.json()["access_token"] and success.json()["refresh_token"]
            assert success.headers.get("set-cookie") is None
            for _ in range(5):
                assert login(identifier).status_code == 401
            assert login(identifier).status_code == 429

            # PostgreSQL CITEXT aliases share a budget even where Python casefold differs.
            now[0] = 1000
            with factory.begin() as db:
                assert db.scalar(select(func.lower("\u0130"))) == "i"
            for _ in range(5):
                assert login("i-nonexistent").status_code == 401
            assert login("\u0130-nonexistent").status_code == 429
    finally:
        engine.dispose()
