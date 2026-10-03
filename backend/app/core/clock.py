from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Protocol
from zoneinfo import ZoneInfo

from app.core.config import settings


class Clock(Protocol):
    def now_utc(self) -> datetime: ...

    def clinic_now(self) -> datetime: ...

    def clinic_date(self) -> date: ...


@dataclass(frozen=True, slots=True)
class SystemClock:
    clinic_timezone: str

    def now_utc(self) -> datetime:
        return datetime.now(timezone.utc)

    def clinic_now(self) -> datetime:
        return self.now_utc().astimezone(ZoneInfo(self.clinic_timezone))

    def clinic_date(self) -> date:
        return self.clinic_now().date()


def get_clock() -> Clock:
    return SystemClock(settings.clinic_timezone)
