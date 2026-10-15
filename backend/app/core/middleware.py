import logging
from time import perf_counter
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import Settings
from app.core.context import request_id_var

request_logger = logging.getLogger("clinicflow.request")


def configure_http_boundary(app: FastAPI, config: Settings) -> None:
    if config.environment in {"staging", "production"}:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.allowed_hosts)
    if config.cors_origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=config.cors_origins, allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"],
            expose_headers=["X-Request-ID", "Retry-After"],
        )


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        supplied = request.headers.get("X-Request-ID")
        request_id = _valid_uuid(supplied) or str(uuid4())
        request.state.request_id = request_id
        token = request_id_var.set(request_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            request_id_var.reset(token)


def _valid_uuid(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(UUID(value))
    except ValueError:
        return None


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Apply conservative API response headers without assuming TLS terminates here."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        started = perf_counter()
        response = await call_next(request)
        duration_ms = round((perf_counter() - started) * 1000, 2)
        request_logger.info(
            "request_complete",
            extra={
                "request_id": getattr(request.state, "request_id", None),
                "method": request.method,
                # Route templates exclude patient identifiers and arbitrary URL text.
                "path": getattr(request.scope.get("route"), "path", "unmatched"),
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response
