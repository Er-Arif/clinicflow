from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
    )


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(
        bind=get_engine(),
        autoflush=False,
        expire_on_commit=False,
    )


def get_db() -> Generator[Session, None, None]:
    with get_session_factory()() as session:
        yield session


def get_auth_db() -> Generator[Session, None, None]:
    # Authentication/permission reads intentionally use a separate short-lived
    # session so protected command endpoints can own their business transaction.
    with get_session_factory()() as session:
        yield session
