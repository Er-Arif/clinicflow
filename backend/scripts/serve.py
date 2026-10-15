"""One worker: auth throttling is intentionally process-local for V1."""

import os

import uvicorn

from app.core.config import settings, validate_runtime_settings


def main() -> None:
    validate_runtime_settings(settings)
    uvicorn.run(
        "app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")),
        workers=1, proxy_headers=bool(settings.trusted_proxy_ips),
        forwarded_allow_ips=",".join(settings.trusted_proxy_ips),
        access_log=False, log_config=None,
    )


if __name__ == "__main__":
    main()
