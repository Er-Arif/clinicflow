import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, sqlalchemy_database_url, validate_runtime_settings
from app.core.middleware import (
    RequestIdMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
)


def test_production_rejects_default_access_secret() -> None:
    config = Settings(environment="production", access_token_secret="development-only-change-me")
    with pytest.raises(RuntimeError, match="ACCESS_TOKEN_SECRET"):
        validate_runtime_settings(config)


def test_production_rejects_short_access_secret() -> None:
    config = Settings(environment="production", access_token_secret="too-short")
    with pytest.raises(RuntimeError, match="ACCESS_TOKEN_SECRET"):
        validate_runtime_settings(config)


def test_production_accepts_strong_secret_and_postgres() -> None:
    config = Settings(
        environment="production",
        access_token_secret="x" * 48,
        database_url="postgresql+psycopg://clinicflow:secret@postgres:5432/clinicflow",
    )
    validate_runtime_settings(config)


def test_standard_postgres_url_uses_psycopg3_driver() -> None:
    standard = "postgresql://clinicflow:secret@postgres:5432/clinicflow"
    explicit = "postgresql+psycopg://clinicflow:secret@postgres:5432/clinicflow"

    assert sqlalchemy_database_url(standard) == explicit
    assert sqlalchemy_database_url(explicit) == explicit


def test_api_responses_include_security_and_request_headers() -> None:
    probe = FastAPI()
    probe.add_middleware(SecurityHeadersMiddleware)
    probe.add_middleware(RequestIdMiddleware)

    @probe.get("/api/probe")
    def header_probe() -> dict[str, bool]:
        return {"ok": True}

    with TestClient(probe) as client:
        response = client.get("/api/probe")

    assert response.status_code == 200
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers.get("x-request-id")


def test_unexpected_request_failure_is_logged_without_exception_details(caplog) -> None:
    probe = FastAPI()
    probe.add_middleware(RequestLoggingMiddleware)
    probe.add_middleware(RequestIdMiddleware)

    @probe.get("/api/explode/{patient_id}")
    def explode(patient_id: str) -> None:
        raise RuntimeError(f"database password=do-not-log patient={patient_id}")

    caplog.set_level(logging.ERROR, logger="clinicflow.request")
    with TestClient(probe, raise_server_exceptions=False) as client:
        response = client.get("/api/explode/patient-secret-value")

    assert response.status_code == 500
    records = [record for record in caplog.records if record.message == "request_failed"]
    assert len(records) == 1
    record = records[0]
    assert record.path == "/api/explode/{patient_id}"
    assert record.status_code == 500
    assert record.request_id
    rendered = caplog.text
    assert "do-not-log" not in rendered
    assert "patient-secret-value" not in rendered


def test_validation_and_unexpected_errors_use_safe_envelope() -> None:
    from app.core.errors import register_exception_handlers

    probe = FastAPI()
    probe.add_middleware(RequestIdMiddleware)
    register_exception_handlers(probe)

    @probe.get("/api/number")
    def number(value: int) -> dict[str, int]:
        return {"value": value}

    @probe.get("/api/explode")
    def explode() -> None:
        raise RuntimeError("database password=do-not-leak")

    with TestClient(probe, raise_server_exceptions=False) as client:
        invalid = client.get("/api/number", params={"value": "not-an-int"})
        failed = client.get("/api/explode")
        missing = client.get("/api/missing")

    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    assert invalid.json()["error"]["request_id"]
    assert "not-an-int" not in str(invalid.json())

    assert failed.status_code == 500
    assert failed.json()["error"]["code"] == "INTERNAL_SERVER_ERROR"
    assert "do-not-leak" not in str(failed.json())
    assert failed.json()["error"]["request_id"]

    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "NOT_FOUND"


def test_audit_service_redacts_authentication_secrets_recursively() -> None:
    from uuid import uuid4

    from app.modules.audit.service import AuditService

    class CaptureDb:
        event = None

        def add(self, event) -> None:
            self.event = event

    db = CaptureDb()
    AuditService(db).record(
        clinic_id=uuid4(),
        actor_type="USER",
        actor_user_id=uuid4(),
        action_type="SECURITY_TEST",
        entity_type="USER",
        entity_id=uuid4(),
        request_id=uuid4(),
        previous_values={"password": "secret", "nested": {"refresh_token": "token"}},
        new_values={"password_hash": "hash", "safe": "kept"},
        metadata={"access_token": "bearer", "secret": "value"},
    )

    assert db.event is not None
    assert db.event.previous_values == {
        "password": "[REDACTED]",
        "nested": {"refresh_token": "[REDACTED]"},
    }
    assert db.event.new_values == {"password_hash": "[REDACTED]", "safe": "kept"}
    assert db.event.metadata_json == {"access_token": "[REDACTED]", "secret": "[REDACTED]"}


def test_json_logging_formatter_keeps_request_metadata_structured() -> None:
    import json

    from app.core.logging import JsonFormatter

    record = logging.LogRecord(
        name="clinicflow.request",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="request_complete",
        args=(),
        exc_info=None,
    )
    record.request_id = "00000000-0000-4000-8000-000000000001"
    record.method = "POST"
    record.path = "/api/v1/appointments"
    record.status_code = 201
    record.duration_ms = 12.5
    payload = json.loads(JsonFormatter().format(record))

    assert payload["message"] == "request_complete"
    assert payload["request_id"] == record.request_id
    assert payload["path"] == "/api/v1/appointments"
    assert payload["status_code"] == 201


def test_system_info_route_is_registered_and_uses_configured_version() -> None:
    from app.main import app

    paths = set(app.openapi()["paths"].keys())
    assert "/api/v1/system/info" in paths
    assert app.version == "0.1.0"
