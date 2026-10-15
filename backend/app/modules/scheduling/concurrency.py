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
    Acquire the shared schedule gate, then all dates in ascending order, before patient,
    follow-up, definition or occurrence row locks/materialization. Supply the complete
    date set up front; nested calls may only reacquire dates already held.
    Reschedule/cancel may first lock their original Appointment: no scheduling writer
    holding the gate waits for that existing appointment row.
    The locks are transaction-level (pg_advisory_xact_lock) and are automatically released
    at transaction commit or rollback.
    """
    if not dates:
        return
    acquire_schedule_gate(db, doctor_id)
    sorted_unique_dates = sorted(set(dates))
    for d in sorted_unique_dates:
        key = _doctor_date_lock_key(doctor_id, d)
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def acquire_schedule_gate(db: Session, doctor_id: UUID, *, exclusive: bool = False) -> None:
    """Serialize recurring edits with writes on *any* date, including beyond the horizon.

    Booking/exception transactions share this gate and still serialize by date.
    Smart-apply takes it exclusively before reading its horizon or locking definitions.
    Never upgrade a shared gate to exclusive within a transaction.
    """
    payload = f"doctor_schedule_gate:{doctor_id}".encode()
    key = struct.unpack(">q", hashlib.sha256(payload).digest()[:8])[0]
    sql = (
        "SELECT pg_advisory_xact_lock(:key)"
        if exclusive else "SELECT pg_advisory_xact_lock_shared(:key)"
    )
    db.execute(text(sql), {"key": key})
