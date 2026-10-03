from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.modules.audit.models import AuditEvent

_REDACTED_KEYS = {
    "password",
    "password_hash",
    "access_token",
    "refresh_token",
    "refresh_token_hash",
    "secret",
}


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if key.lower() in _REDACTED_KEYS else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


class AuditService:
    def __init__(self, db: Session):
        self.db = db

    def record(
        self,
        *,
        clinic_id: UUID,
        actor_type: str,
        actor_user_id: UUID | None,
        action_type: str,
        entity_type: str,
        entity_id: UUID | None,
        request_id: UUID,
        reason: str | None = None,
        previous_values: dict | None = None,
        new_values: dict | None = None,
        metadata: dict | None = None,
    ) -> AuditEvent:
        event = AuditEvent(
            clinic_id=clinic_id,
            actor_type=actor_type,
            actor_user_id=actor_user_id,
            action_type=action_type,
            entity_type=entity_type,
            entity_id=entity_id,
            reason=reason,
            previous_values=_redact(previous_values),
            new_values=_redact(new_values),
            metadata_json=_redact(metadata),
            request_id=request_id,
        )
        self.db.add(event)
        return event
