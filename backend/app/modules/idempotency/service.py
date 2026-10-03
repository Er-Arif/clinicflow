from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.errors import AppError
from app.modules.idempotency.models import IdempotencyRecord


class IdempotencyService:
    RETENTION = timedelta(days=7)

    def __init__(self, db: Session, clock: Clock):
        self.db = db
        self.clock = clock

    @staticmethod
    def request_hash(payload: Any) -> str:
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
        return hashlib.sha256(encoded).hexdigest()

    def find(
        self, *, user_id: UUID, operation: str, key: str
    ) -> IdempotencyRecord | None:
        return self.db.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.user_id == user_id,
                IdempotencyRecord.operation == operation,
                IdempotencyRecord.idempotency_key == key,
            )
        )

    def reserve(
        self,
        *,
        clinic_id: UUID,
        user_id: UUID,
        operation: str,
        key: str,
        request_hash: str,
    ) -> IdempotencyRecord:
        existing = self.find(user_id=user_id, operation=operation, key=key)
        if existing:
            if existing.request_hash != request_hash:
                raise AppError(
                    code="IDEMPOTENCY_KEY_REUSE",
                    message="This request key was already used with different data.",
                    status_code=409,
                )
            if existing.response_body is None:
                raise AppError(
                    code="IDEMPOTENCY_IN_PROGRESS",
                    message="The same request is already being processed.",
                    status_code=409,
                )
            return existing

        record = IdempotencyRecord(
            clinic_id=clinic_id,
            user_id=user_id,
            operation=operation,
            idempotency_key=key,
            request_hash=request_hash,
            expires_at=self.clock.now_utc() + self.RETENTION,
        )
        self.db.add(record)
        try:
            self.db.flush()
        except IntegrityError:
            # The command service should run this reservation in the same transaction.
            # A concurrent insert of the same unique key is surfaced as a conflict/retry path.
            raise AppError(
                code="IDEMPOTENCY_IN_PROGRESS",
                message="The same request is already being processed.",
                status_code=409,
            ) from None
        return record
