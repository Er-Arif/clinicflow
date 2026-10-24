from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AppointmentStatusSummary:
    total: int = 0
    booked: int = 0
    checked_in: int = 0
    completed: int = 0
    cancelled: int = 0
    no_show: int = 0
    rescheduled: int = 0


def summarize_appointment_status_rows(
    rows: Iterable[tuple[str, str | None, int]],
) -> AppointmentStatusSummary:
    status_counts: dict[str, int] = {}
    ordinary_cancelled = 0
    no_show = 0
    rescheduled = 0
    total = 0

    for status, reason, count in rows:
        value = int(count)
        total += value
        status_counts[status] = status_counts.get(status, 0) + value
        if status != "CANCELLED":
            continue
        if reason == "NO_SHOW":
            no_show += value
        elif reason == "RESCHEDULED":
            rescheduled += value
        else:
            ordinary_cancelled += value

    return AppointmentStatusSummary(
        total=total,
        booked=status_counts.get("BOOKED", 0),
        checked_in=status_counts.get("CHECKED_IN", 0),
        completed=status_counts.get("COMPLETED", 0),
        cancelled=ordinary_cancelled,
        no_show=no_show,
        rescheduled=rescheduled,
    )
