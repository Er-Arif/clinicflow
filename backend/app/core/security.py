from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.clock import Clock
from app.core.config import settings
from app.core.errors import AppError

_password_hasher = PasswordHasher()


class PasswordService:
    @staticmethod
    def hash(password: str) -> str:
        return _password_hasher.hash(password)

    @staticmethod
    def verify(password_hash: str, password: str) -> bool:
        try:
            return _password_hasher.verify(password_hash, password)
        except (VerifyMismatchError, InvalidHashError):
            return False


@dataclass(frozen=True, slots=True)
class AccessClaims:
    user_id: UUID
    clinic_id: UUID
    session_id: UUID


class TokenService:
    def __init__(self, clock: Clock):
        self.clock = clock

    def create_access_token(self, *, user_id: UUID, clinic_id: UUID, session_id: UUID) -> str:
        now = self.clock.now_utc()
        expires = now + timedelta(minutes=settings.access_token_minutes)
        payload = {
            "sub": str(user_id),
            "cid": str(clinic_id),
            "sid": str(session_id),
            "jti": str(uuid4()),
            "iat": now,
            "exp": expires,
            "typ": "access",
        }
        return jwt.encode(payload, settings.access_token_secret, algorithm=settings.jwt_algorithm)

    def decode_access_token(self, token: str) -> AccessClaims:
        try:
            payload = jwt.decode(
                token,
                settings.access_token_secret,
                algorithms=[settings.jwt_algorithm],
                options={"require": ["sub", "cid", "sid", "exp", "iat"]},
            )
            if payload.get("typ") != "access":
                raise ValueError("invalid token type")
            return AccessClaims(
                user_id=UUID(payload["sub"]),
                clinic_id=UUID(payload["cid"]),
                session_id=UUID(payload["sid"]),
            )
        except (jwt.PyJWTError, ValueError, KeyError) as exc:
            raise AppError(
                code="AUTHENTICATION_REQUIRED",
                message="Your session is invalid or has expired.",
                status_code=401,
            ) from exc

    @staticmethod
    def new_refresh_token() -> str:
        return secrets.token_urlsafe(48)

    @staticmethod
    def hash_refresh_token(token: str) -> bytes:
        return hashlib.sha256(token.encode("utf-8")).digest()
