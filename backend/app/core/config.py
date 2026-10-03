from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="CLINICFLOW_",
        extra="ignore",
    )

    environment: str = "local"
    database_url: str = "postgresql+psycopg://clinicflow:clinicflow@localhost:5432/clinicflow"
    clinic_timezone: str = "Asia/Kolkata"
    log_level: str = "INFO"
    api_prefix: str = "/api/v1"
    access_token_secret: str = "development-only-change-me"
    access_token_minutes: int = 15
    refresh_session_days: int = 30
    jwt_algorithm: str = "HS256"
    app_version: str = "0.1.0"
    build_commit: str = "development"
    minimum_mobile_version: str = "0.1.0"


def validate_runtime_settings(config: Settings) -> None:
    """Fail closed when a deploy-like environment uses unsafe runtime settings."""

    environment = config.environment.strip().lower()
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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
