from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(tags=["system"])


@router.get("/system/info")
def system_info() -> dict[str, str]:
    return {
        "service": "clinicflow-api",
        "api_version": settings.app_version,
        "build_commit": settings.build_commit,
        "environment": settings.environment,
        "minimum_mobile_version": settings.minimum_mobile_version,
        "latest_mobile_version": settings.latest_mobile_version,
    }
