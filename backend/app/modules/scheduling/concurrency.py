from __future__ import annotations

import hashlib
import struct
from collections.abc import Sequence
from datetime import date
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


def _doctor_date_lock_key(doctor_id: UUID, target_date: date) -> int:
    """
    Compute a deterministic 64-bit signed integer key from doctor UUID and clinic date.
    Uses SHA-256 with a domain-separated prefix.
    """
    payload = f"doctor_date_lock:{doctor_id}:{target_date.isoformat()}".encode()
    digest = hashlib.sha256(payload).digest()[:8]
    return struct.unpack(">q", digest)[0]


def acquire_doctor_date_locks(db: Session, doctor_id: UUID, dates: Sequence[date]) -> None:
    """
    Acquire transaction-scoped PostgreSQL advisory locks for a doctor across specific dates.
    Locks are acquired in strictly ascending chronological order to eliminate deadlocks.
    The locks are transaction-level (pg_advisory_xact_lock) and are automatically released
    at transaction commit or rollback.
    """
    if not dates:
        return
    sorted_unique_dates = sorted(set(dates))
    for d in sorted_unique_dates:
        key = _doctor_date_lock_key(doctor_id, d)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
