"""Exact, shared timed-slot semantics (including the full end interval)."""

from datetime import date, datetime, time, timedelta


def is_valid_slot(value: time, start: time, end: time, interval_minutes: int) -> bool:
    anchor = date(2000, 1, 1)
    offset = datetime.combine(anchor, value) - datetime.combine(anchor, start)
    duration = datetime.combine(anchor, end) - datetime.combine(anchor, start)
    interval = timedelta(minutes=interval_minutes)
    return (
        offset >= timedelta() and offset % interval == timedelta() and offset + interval <= duration
    )


def generate_slots(start: time, end: time, interval_minutes: int) -> list[time]:
    anchor = date(2000, 1, 1)
    current = datetime.combine(anchor, start)
    finish = datetime.combine(anchor, end)
    interval = timedelta(minutes=interval_minutes)
    slots: list[time] = []
    while current < finish and is_valid_slot(current.time(), start, end, interval_minutes):
        slots.append(current.time())
        current += interval
    return slots
