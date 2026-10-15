import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.router import api_router
from app.core.config import settings, validate_runtime_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import (
    RequestIdMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
    configure_http_boundary,
)
from app.db.session import get_engine

configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_runtime_settings(settings)
    logger = logging.getLogger("clinicflow.lifecycle")
    logger.info("application_startup")
    try:
        yield
    finally:
        get_engine().dispose()
        logger.info("application_shutdown")


app = FastAPI(
    title="ClinicFlow API",
    version=settings.app_version,
    lifespan=lifespan,
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(RequestIdMiddleware)
configure_http_boundary(app, settings)
register_exception_handlers(app)
app.include_router(api_router)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"service": "clinicflow-api", "environment": settings.environment}
