from fastapi import APIRouter
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(tags=["system"])


class SystemInfoResponse(BaseModel):
    service: str
    api_version: str
    minimum_mobile_version: str
    minimum_mobile_version_code: int
    latest_mobile_version: str
    latest_mobile_version_code: int
    mobile_apk_url: str | None
    mobile_apk_sha256: str | None
    mobile_release_notes: str
    mobile_update_mandatory: bool


@router.get("/system/info", response_model=SystemInfoResponse)
def system_info() -> SystemInfoResponse:
    apk_url = settings.mobile_apk_url.strip() or None
    apk_sha256 = settings.mobile_apk_sha256.strip().lower() or None
    return SystemInfoResponse(
        service="clinicflow-api",
        api_version=settings.app_version,
        minimum_mobile_version=settings.minimum_mobile_version,
        minimum_mobile_version_code=settings.minimum_mobile_version_code,
        latest_mobile_version=settings.latest_mobile_version,
        latest_mobile_version_code=settings.latest_mobile_version_code,
        mobile_apk_url=apk_url,
        mobile_apk_sha256=apk_sha256,
        mobile_release_notes=settings.mobile_release_notes.strip(),
        mobile_update_mandatory=settings.mobile_update_mandatory,
    )
