import re
from functools import lru_cache
from ipaddress import ip_network
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

MOBILE_VERSION_PATTERN = re.compile(
    r"^v?\d+(?:\.\d+)*(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
MOBILE_SHA256_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="CLINICFLOW_",
        extra="ignore",
    )

    environment: Literal["local", "test", "development", "staging", "production"] = "local"
    database_url: str = "postgresql+psycopg://clinicflow:clinicflow@localhost:5432/clinicflow"
    clinic_timezone: str = "Asia/Kolkata"
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"
    access_token_secret: str = "development-only-change-me"
    access_token_minutes: int = Field(default=15, ge=1, le=60)
    refresh_session_days: int = Field(default=30, ge=1, le=90)
    jwt_algorithm: Literal["HS256"] = "HS256"
    app_version: str = "0.1.0"
    build_commit: str = "development"
    minimum_mobile_version: str = "0.1.0"
    minimum_mobile_version_code: int = Field(default=1, ge=1)
    latest_mobile_version: str = "0.1.0"
    latest_mobile_version_code: int = Field(default=1, ge=1)
    mobile_apk_url: str = ""
    mobile_apk_sha256: str = ""
    mobile_release_notes: str = ""
    mobile_update_mandatory: bool = False
    allowed_hosts: list[str] = Field(default_factory=lambda: ["localhost", "127.0.0.1", "testserver"])
    cors_origins: list[str] = Field(default_factory=list)
    trusted_proxy_ips: list[str] = Field(default_factory=list)
    client_ip_source: Literal["socket", "railway", "render"] = "socket"
    db_pool_size: int = Field(default=5, ge=1, le=50)
    db_max_overflow: int = Field(default=5, ge=0, le=50)
    db_pool_timeout: int = Field(default=10, ge=1, le=120)
    db_pool_recycle: int = Field(default=1800, ge=60)
    db_connect_timeout: int = Field(default=5, ge=1, le=60)


def sqlalchemy_database_url(value: str) -> str:
    """Use ClinicFlow's psycopg 3 driver for standard managed-Postgres URLs."""
    if value.startswith("postgresql://"):
        return f"postgresql+psycopg://{value[len('postgresql://') :]}"
    return value


def validate_runtime_settings(config: Settings) -> None:
    """Fail closed when a deploy-like environment uses unsafe runtime settings."""

    environment = config.environment.strip().lower()
    for proxy in config.trusted_proxy_ips:
        try:
            network = ip_network(proxy, strict=False)
        except ValueError as exc:
            raise RuntimeError("TRUSTED_PROXY_IPS must contain explicit IPs or CIDRs.") from exc
        if network.prefixlen == 0:
            raise RuntimeError("TRUSTED_PROXY_IPS must not trust every address.")
    for origin in config.cors_origins:
        parsed = urlsplit(origin)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                or parsed.username or parsed.password or parsed.path
                or parsed.query or parsed.fragment or "*" in origin):
            raise RuntimeError("CORS_ORIGINS must contain exact origins without paths or wildcards.")
        if environment in {"staging", "production"} and parsed.scheme != "https":
            raise RuntimeError("Production CORS_ORIGINS must use HTTPS.")

    _validate_mobile_update_settings(config)

    if environment not in {"staging", "production"}:
        return

    secret = config.access_token_secret.strip()
    unsafe_secret = (
        len(secret) < 32
        or secret == "development-only-change-me"
        or secret.lower().startswith(("replace-with", "changeme", "change-me"))
    )
    if unsafe_secret:
        raise RuntimeError(
            "CLINICFLOW_ACCESS_TOKEN_SECRET must be a non-default secret of at least 32 characters "
            "in staging/production."
        )

    if not config.database_url.startswith(("postgresql://", "postgresql+psycopg://")):
        raise RuntimeError("ClinicFlow staging/production requires PostgreSQL.")
    password = make_url(config.database_url).password or ""
    if not password or password.lower() in {"clinicflow", "postgres", "password"} or password.lower().startswith(("replace-", "change")):
        raise RuntimeError("Production DATABASE_URL requires a non-placeholder database password.")
    if not config.allowed_hosts or any("*" in host or "/" in host for host in config.allowed_hosts):
        raise RuntimeError("Production ALLOWED_HOSTS requires explicit host names.")


def _validate_mobile_update_settings(config: Settings) -> None:
    for value, label in (
        (config.minimum_mobile_version, "MINIMUM_MOBILE_VERSION"),
        (config.latest_mobile_version, "LATEST_MOBILE_VERSION"),
    ):
        if not MOBILE_VERSION_PATTERN.fullmatch(value.strip()):
            raise RuntimeError(f"{label} must use a semantic numeric version such as 1.0.0 or 1.0.0-rc.1.")

    if config.minimum_mobile_version_code > config.latest_mobile_version_code:
        raise RuntimeError("MINIMUM_MOBILE_VERSION_CODE must not exceed LATEST_MOBILE_VERSION_CODE.")

    apk_url = config.mobile_apk_url.strip()
    apk_sha256 = config.mobile_apk_sha256.strip()
    if bool(apk_url) != bool(apk_sha256):
        raise RuntimeError("MOBILE_APK_URL and MOBILE_APK_SHA256 must be configured together.")
    if not apk_url:
        return

    parsed = urlsplit(apk_url)
    if parsed.scheme != "https" or parsed.hostname != "github.com" or parsed.username or parsed.password:
        raise RuntimeError("MOBILE_APK_URL must be an HTTPS github.com release asset URL.")
    if not MOBILE_SHA256_PATTERN.fullmatch(apk_sha256):
        raise RuntimeError("MOBILE_APK_SHA256 must contain exactly 64 hexadecimal characters.")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()