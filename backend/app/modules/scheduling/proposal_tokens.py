from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

import jwt

from app.core.config import settings
from app.core.errors import AppError
from app.modules.scheduling.schemas import SessionWrite


def normalize_proposal_hash(weekdays: list[int], sessions: list[SessionWrite]) -> str:
    sorted_weekdays = sorted(weekdays)
    sorted_sessions = sorted(sessions, key=lambda session: session.display_order)
    canonical = {
        "weekdays": sorted_weekdays,
        "sessions": [
            {
                "display_order": session.display_order,
                "session_name": session.session_name.strip(),
                "start_time": session.start_time.isoformat(),
                "end_time": session.end_time.isoformat(),
                "slot_interval_minutes": session.slot_interval_minutes,
                "maximum_capacity": session.maximum_capacity,
                "active": session.active,
            }
            for session in sorted_sessions
        ],
    }
    dumped = json.dumps(canonical, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()


def _proposal_token_secret() -> str:
    # Purpose-separate proposal signing from access-token signing even though
    # both roots currently derive from the deployment secret.
    return hashlib.sha256(
        f"schedule_proposal_v1:{settings.access_token_secret}".encode()
    ).hexdigest()


def create_proposal_token(
    clinic_id: UUID,
    doctor_id: UUID,
    payload_hash: str,
    weekdays: list[int],
    expected_states: dict[str, Any],
    now: datetime,
) -> str:
    expires = now + timedelta(minutes=10)
    claims = {
        "sub": str(doctor_id),
        "cid": str(clinic_id),
        "phash": payload_hash,
        "weekdays": sorted(weekdays),
        "expected_states": expected_states,
        "iat": now,
        "exp": expires,
        "typ": "schedule_proposal",
    }
    return jwt.encode(claims, _proposal_token_secret(), algorithm=settings.jwt_algorithm)


def decode_and_verify_proposal_token(
    token: str,
    clinic_id: UUID,
    doctor_id: UUID,
    expected_payload_hash: str,
    now: datetime,
) -> dict[str, Any]:
    try:
        claims = jwt.decode(
            token,
            _proposal_token_secret(),
            algorithms=[settings.jwt_algorithm],
            options={
                "verify_exp": False,
                "verify_iat": False,
                "require": [
                    "sub",
                    "cid",
                    "phash",
                    "weekdays",
                    "expected_states",
                    "exp",
                    "iat",
                ],
            },
        )
    except jwt.PyJWTError as exc:
        raise AppError(
            code="STALE_SCHEDULE_PREVIEW",
            message="Invalid schedule proposal token.",
            status_code=409,
        ) from exc

    exp = claims.get("exp")
    if exp is not None and int(now.timestamp()) > exp:
        raise AppError(
            code="STALE_SCHEDULE_PREVIEW",
            message="Schedule proposal has expired. Please review and apply again.",
            status_code=409,
        )

    if claims.get("typ") != "schedule_proposal":
        raise AppError(
            code="STALE_SCHEDULE_PREVIEW",
            message="Invalid token type.",
            status_code=409,
        )
    if claims.get("cid") != str(clinic_id) or claims.get("sub") != str(doctor_id):
        raise AppError(
            code="STALE_SCHEDULE_PREVIEW",
            message="Proposal token does not match doctor or clinic.",
            status_code=409,
        )
    if claims.get("phash") != expected_payload_hash:
        raise AppError(
            code="STALE_SCHEDULE_PREVIEW",
            message="Proposal payload does not match preview.",
            status_code=409,
        )
    return claims
