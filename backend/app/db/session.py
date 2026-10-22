from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings, sqlalchemy_database_url, validate_runtime_settings


@lru_cache
def get_engine() -> Engine:
    validate_runtime_settings(settings)
    return create_engine(
        sqlalchemy_database_url(settings.database_url),
        pool_pre_ping=True,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout,
        pool_recycle=settings.db_pool_recycle,
        connect_args={"connect_timeout": settings.db_connect_timeout},
        hide_parameters=True,
    )


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(
        bind=get_engine(),
        autoflush=False,
        expire_on_commit=False,
    )


def get_db() -> Generator[Session]:
    with get_session_factory()() as session:
        yield session


def get_auth_db() -> Generator[Session]:
    # Authentication/permission reads intentionally use a separate short-lived
    # session so protected command endpoints can own their business transaction.
    with get_session_factory()() as session:
        yield session
