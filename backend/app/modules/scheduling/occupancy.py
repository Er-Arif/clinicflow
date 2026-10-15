"""Effective occupancy without changing appointments' historical anchors.

This read-only calculation takes no locks. Mutation callers must already hold the
schedule gate and the complete doctor/date lock set before reading occupancy.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date, time
from typing import Protocol
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.scheduling.models import ScheduleDefinition, SessionDefinition, SessionOccurrence
from app.modules.scheduling.slots import is_valid_slot


class SessionWindow(Protocol):
    start_time: time
    end_time: time
    slot_interval_minutes: int
    maximum_capacity: int
    session_name: str


@dataclass
class SessionOccupancy:
    appointment_ids: set[UUID] = field(default_factory=set)
    occupied_times: set[time] = field(default_factory=set)

    @property
    def used_capacity(self) -> int:
        return len(self.appointment_ids)


@dataclass
class EffectiveOccupancy:
    sessions: list[SessionOccupancy]
    appointment_count: int
    mapping_conflicts: list[str]
    slot_conflicts: list[str]

    def require_valid_mapping(self) -> None:
        conflicts = self.mapping_conflicts + self.slot_conflicts
        if conflicts:
            raise AppError("SCHEDULE_OCCUPANCY_CONFLICT", conflicts[0], 409)

    def conflict_reason(self, windows: Sequence[SessionWindow]) -> str | None:
        conflicts = self.mapping_conflicts + self.slot_conflicts
        if conflicts:
            return conflicts[0]
        for window, occupancy in zip(windows, self.sessions, strict=True):
            if occupancy.used_capacity > window.maximum_capacity:
                return (
                    f"Booked appointments ({occupancy.used_capacity}) exceed proposed "
                    f"capacity ({window.maximum_capacity}) for {window.session_name}."
                )
        return None


def effective_sessions(
    db: Session, clinic_id: UUID, doctor_id: UUID, target_date: date
) -> list[SessionDefinition]:
    return list(
        db.scalars(
            select(SessionDefinition)
            .join(ScheduleDefinition)
            .where(
                ScheduleDefinition.clinic_id == clinic_id,
                SessionDefinition.clinic_id == clinic_id,
                ScheduleDefinition.doctor_id == doctor_id,
                ScheduleDefinition.weekday == target_date.weekday(),
                ScheduleDefinition.active.is_(True),
                ScheduleDefinition.effective_from <= target_date,
                or_(
                    ScheduleDefinition.effective_to.is_(None),
                    ScheduleDefinition.effective_to >= target_date,
                ),
                SessionDefinition.active.is_(True),
            )
            .order_by(SessionDefinition.display_order, SessionDefinition.start_time)
            .execution_options(populate_existing=True)
        ).all()
    )


def timed_session_indices(windows: Sequence[SessionWindow], value: time) -> list[int]:
    # Half-open windows distinguish adjacent sessions without first-match ordering.
    return [i for i, window in enumerate(windows) if window.start_time <= value < window.end_time]


def effective_occupancy(
    db: Session,
    clinic_id: UUID,
    doctor_id: UUID,
    target_date: date,
    windows: Sequence[SessionWindow],
    *,
    exclude_appointment_id: UUID | None = None,
) -> EffectiveOccupancy:
    query = (
        select(Appointment, SessionOccurrence)
        .join(
            SessionOccurrence,
            Appointment.session_occurrence_id == SessionOccurrence.session_occurrence_id,
        )
        .where(
            Appointment.clinic_id == clinic_id,
            Appointment.doctor_id == doctor_id,
            Appointment.status != "CANCELLED",
            SessionOccurrence.clinic_id == clinic_id,
            SessionOccurrence.doctor_id == doctor_id,
            SessionOccurrence.occurrence_date == target_date,
        )
        .order_by(Appointment.appointment_id)
    )
    if exclude_appointment_id is not None:
        query = query.where(Appointment.appointment_id != exclude_appointment_id)
    rows = db.execute(query).all()
    result = EffectiveOccupancy([SessionOccupancy() for _ in windows], len(rows), [], [])
    for appointment, anchor in rows:
        value = appointment.appointment_time
        if value is not None:
            matches = timed_session_indices(windows, value)
        else:
            # A current anchor is explicit identity. Across versions require a
            # unique overlapping historical window: names/order are mutable labels,
            # and a split/merge must not silently relocate an untimed patient.
            matches = [
                i
                for i, window in enumerate(windows)
                if getattr(window, "session_definition_id", None) == anchor.session_definition_id
            ]
            if not matches:
                matches = [
                    i
                    for i, window in enumerate(windows)
                    if window.start_time < anchor.end_time_snapshot
                    and anchor.start_time_snapshot < window.end_time
                ]
        if len(matches) != 1:
            label = f"Appointment at {value.strftime('%H:%M')}" if value else "Untimed appointment"
            result.mapping_conflicts.append(
                f"{label} has ambiguous session mapping."
                if matches
                else f"{label} falls outside proposed hours (no corresponding session)."
            )
            continue
        index = matches[0]
        occupancy = result.sessions[index]
        occupancy.appointment_ids.add(appointment.appointment_id)
        if value is not None:
            occupancy.occupied_times.add(value)
            window = windows[index]
            if not is_valid_slot(
                value, window.start_time, window.end_time, window.slot_interval_minutes
            ):
                result.slot_conflicts.append(
                    f"Appointment at {value.strftime('%H:%M')} does not align with a full "
                    f"{window.slot_interval_minutes}-minute slot within session hours."
                )
    return result
