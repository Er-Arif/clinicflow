from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.context import request_id_var

logger = logging.getLogger("clinicflow.errors")


@dataclass(slots=True)
class AppError(Exception):
    code: str
    message: str
    status_code: int = 400
    details: dict[str, Any] = field(default_factory=dict)


def _request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None) or request_id_var.get()


def _body(
    *,
    code: str,
    message: str,
    request_id: str | None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "request_id": request_id,
        }
    }


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_body(
                code=exc.code,
                message=exc.message,
                details=exc.details,
                request_id=_request_id(request),
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        fields = [
            {
                "location": [str(part) for part in error.get("loc", ())],
                "message": str(error.get("msg", "Invalid value.")),
                "type": str(error.get("type", "validation_error")),
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=_body(
                code="VALIDATION_ERROR",
                message="Check the entered information and try again.",
                details={"fields": fields},
                request_id=_request_id(request),
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            code, message = "NOT_FOUND", "The requested ClinicFlow resource was not found."
        elif exc.status_code == 405:
            code = "METHOD_NOT_ALLOWED"
            message = "This action is not supported for the requested resource."
        else:
            code, message = "HTTP_ERROR", "The request could not be completed."
        return JSONResponse(
            status_code=exc.status_code,
            content=_body(code=code, message=message, request_id=_request_id(request)),
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        request_id = _request_id(request)
        logger.error(
            "Unhandled ClinicFlow request error request_id=%s exception_type=%s",
            request_id,
            type(exc).__name__,
        )
        return JSONResponse(
            status_code=500,
            content=_body(
                code="INTERNAL_SERVER_ERROR",
                message="ClinicFlow could not complete the request. Try again.",
                request_id=request_id,
            ),
            headers={
                "X-Request-ID": request_id or "",
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
                "Referrer-Policy": "no-referrer",
                **({"Cache-Control": "no-store"} if request.url.path.startswith("/api/") else {}),
            },
        )
