import importlib.util
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.api.routes.health import router as health_router
from app.core.auth_throttle import AuthThrottle, auth_client_ip
from app.core.config import Settings, validate_runtime_settings
from app.core.errors import AppError, register_exception_handlers
from app.core.middleware import (
    RequestIdMiddleware,
    RequestLoggingMiddleware,
    configure_http_boundary,
)
from app.db.session import get_db


def test_auth_burst_recovery_aliases_and_independence():
    now = [0.0]
    throttle = AuthThrottle(timer=lambda: now[0])
    for _ in range(5):
        throttle.check("one", " User ")
    with pytest.raises(AppError) as failure:
        throttle.check("different-ip", "USER")
    assert failure.value.status_code == 429
    assert failure.value.details["retry_after_seconds"] == 60
    throttle.check("different-ip", "another-user")
    now[0] = 61
    throttle.check("one", "user")
    throttle.success(" USER ")
    for _ in range(5):
        throttle.check("one", "user")


def test_auth_sustained_budget_and_success_does_not_reset_ip():
    now = [0.0]
    throttle = AuthThrottle(timer=lambda: now[0])
    for window in range(4):
        now[0] = window * 61
        for _ in range(5):
            throttle.check("one", "user")
    now[0] = 244
    with pytest.raises(AppError):
        throttle.check("one", "user")
    now[0] = 901
    throttle.check("one", "user")
    throttle = AuthThrottle()
    for _ in range(20):
        throttle.check("one", "user")
        throttle.success("user")
    with pytest.raises(AppError):
        throttle.check("one", "user")


def test_auth_parallel_reservations_are_atomic():
    throttle = AuthThrottle()
    def attempt(_):
        try:
            throttle.check("one", "user")
            return True
        except AppError:
            return False
    with ThreadPoolExecutor(max_workers=20) as executor:
        assert sum(executor.map(attempt, range(30))) == 5


def test_auth_memory_bound_fails_closed_then_recovers():
    now = [0.0]
    throttle = AuthThrottle(timer=lambda: now[0], max_keys=2)
    throttle.check("one", "user")
    with pytest.raises(AppError):
        throttle.check("two", "other")
    now[0] = 901
    throttle.check("two", "other")
    assert len(throttle._attempts) == 2


@pytest.mark.parametrize(("peer", "forwarded", "expected"), [
    ("198.51.100.1", "1.2.3.4", "198.51.100.1"),
    ("10.0.0.1", "198.51.100.2", "198.51.100.2"),
    ("10.0.0.1", "1.2.3.4, 198.51.100.2", "198.51.100.2"),
])
def test_only_explicitly_trusted_proxy_can_supply_client_ip(peer, forwarded, expected):
    from fastapi import Request
    probe = FastAPI()
    @probe.get("/peer")
    def identity(request: Request):
        return {"ip": auth_client_ip(request)}
    proxy = ProxyHeadersMiddleware(probe, trusted_hosts=["10.0.0.1"])
    with TestClient(proxy, client=(peer, 1234)) as client:
        assert client.get("/peer", headers={"X-Forwarded-For": forwarded}).json() == {"ip": expected}


@pytest.mark.parametrize("overrides", [
    {"access_token_secret": "replace-with-" + "x" * 40},
    {"database_url": "postgresql+psycopg://clinicflow:clinicflow@db/app"},
    {"allowed_hosts": ["*"]},
    {"cors_origins": ["https://*.example.com"]},
    {"cors_origins": ["http://example.com"]},
    {"cors_origins": ["https://example.com/path"]},
    {"trusted_proxy_ips": ["*"]},
    {"trusted_proxy_ips": ["0.0.0.0/0"]},
])
def test_production_rejects_unsafe_configuration(overrides):
    values = dict(environment="production", access_token_secret="x" * 48,
                  database_url="postgresql+psycopg://clinic:strong-db-secret@db/app",
                  allowed_hosts=["api.example.com"])
    with pytest.raises(RuntimeError):
        validate_runtime_settings(Settings(_env_file=None, **(values | overrides)))


@pytest.mark.parametrize("overrides", [
    {"environment": "prod"}, {"access_token_minutes": 0}, {"refresh_session_days": -1},
    {"db_pool_size": 0}, {"db_max_overflow": -1},
])
def test_invalid_environment_and_unbounded_runtime_values_are_rejected(overrides):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **overrides)


@pytest.mark.parametrize("healthy", [True, False])
def test_readiness_dependency_failure_is_safe_503_and_liveness_stays_live(healthy):
    class ProbeDb:
        def execute(self, _):
            if not healthy:
                raise OperationalError("secret-db-url", {}, Exception("private"))
    probe = FastAPI()
    probe.include_router(health_router)
    register_exception_handlers(probe)
    probe.dependency_overrides[get_db] = lambda: ProbeDb()
    with TestClient(probe) as client:
        assert client.get("/health/live").status_code == 200
        response = client.get("/health/ready")
    assert response.status_code == (200 if healthy else 503)
    assert "secret-db" not in response.text


def test_backup_checksum_survives_relocation_and_rejects_corruption(tmp_path):
    path = Path(__file__).resolve().parents[2] / "scripts" / "backup_integrity.py"
    spec = importlib.util.spec_from_file_location("backup_integrity", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    dump = tmp_path / "daily" / "test.dump"
    dump.parent.mkdir()
    dump.write_bytes(b"PGDMP test bytes")
    module.write_checksum(dump)
    module.verify_checksum(dump)
    import shutil
    shutil.copytree(dump.parent, tmp_path / "weekly")
    moved = tmp_path / "weekly" / dump.name
    dump.unlink()
    module.verify_checksum(moved)
    moved.write_bytes(b"corruption")
    with pytest.raises(ValueError):
        module.verify_checksum(moved)
    moved.with_name(moved.name + ".sha256").unlink()
    with pytest.raises(FileNotFoundError):
        module.verify_checksum(moved)


def test_cors_allows_only_configured_origin_without_cookie_credentials():
    probe = FastAPI()
    configure_http_boundary(probe, Settings(_env_file=None, environment="production",
        allowed_hosts=["testserver"], cors_origins=["https://ui.example.com"]))
    @probe.get("/probe")
    def endpoint():
        return {"ok": True}
    with TestClient(probe) as client:
        allowed = client.options("/probe", headers={"Origin": "https://ui.example.com",
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,idempotency-key"})
        assert allowed.status_code == 200
        assert allowed.headers["Access-Control-Allow-Origin"] == "https://ui.example.com"
        assert "Access-Control-Allow-Credentials" not in allowed.headers
        denied = client.options("/probe", headers={"Origin": "https://evil.example",
            "Access-Control-Request-Method": "POST"})
        assert denied.status_code == 400
        assert "Access-Control-Allow-Origin" not in denied.headers
        assert client.get("/probe", headers={"Host": "evil.example"}).status_code == 400


def test_request_logging_uses_route_template_and_correlated_id(caplog):
    import logging
    probe = FastAPI()
    probe.add_middleware(RequestLoggingMiddleware)
    probe.add_middleware(RequestIdMiddleware)
    @probe.get("/patient/{patient_id}")
    def endpoint(patient_id: str):
        return {"ok": True}
    with caplog.at_level(logging.INFO, logger="clinicflow.request"), TestClient(probe) as client:
        response = client.get("/patient/private-name?token=secret")
    record = next(r for r in caplog.records if r.name == "clinicflow.request")
    assert record.path == "/patient/{patient_id}"
    assert record.request_id == response.headers["X-Request-ID"]


def test_deployment_launcher_forces_single_worker_and_explicit_proxy_trust(monkeypatch):
    from scripts import serve
    calls = []
    monkeypatch.setattr(serve, "settings", Settings(_env_file=None, trusted_proxy_ips=["10.0.0.1"]))
    monkeypatch.setenv("PORT", "8123")
    monkeypatch.setenv("WEB_CONCURRENCY", "8")
    monkeypatch.setattr(serve.uvicorn, "run", lambda *args, **kwargs: calls.append(kwargs))
    serve.main()
    assert calls[0]["port"] == 8123 and calls[0]["workers"] == 1
    assert calls[0]["forwarded_allow_ips"] == "10.0.0.1"
    assert calls[0]["access_log"] is False
