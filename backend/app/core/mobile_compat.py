from typing import Annotated

from fastapi import Header

from app.core.config import settings
from app.core.errors import AppError

MOBILE_VERSION_HEADER = "X-ClinicFlow-Mobile-Version-Code"


def require_supported_mobile(
    mobile_version_code: Annotated[str | None, Header(alias=MOBILE_VERSION_HEADER)] = None,
) -> None:
    minimum = settings.minimum_mobile_version_code

    # V1 ships before this header existed. Keep the initial minimum compatible
    # with those builds; once minimum > 1, a missing build code is unsupported.
    if mobile_version_code is None:
        if minimum <= 1:
            return
        _raise_update_required(installed_code=None)

    try:
        installed = int(mobile_version_code)
    except (TypeError, ValueError):
        _raise_update_required(installed_code=None)
        return

    if installed < 1 or installed < minimum:
        _raise_update_required(installed_code=installed if installed > 0 else None)


def _raise_update_required(*, installed_code: int | None) -> None:
    raise AppError(
        "MOBILE_UPDATE_REQUIRED",
        "This ClinicFlow app version must be updated before clinic work can continue.",
        426,
        {
            "installed_version_code": installed_code,
            "minimum_version": settings.minimum_mobile_version,
            "minimum_version_code": settings.minimum_mobile_version_code,
            "latest_version": settings.latest_mobile_version,
            "latest_version_code": settings.latest_mobile_version_code,
        },
    )
