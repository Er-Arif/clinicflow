"""Weekday lifecycle discovery and canonical stored-state freshness.

Working inactivity is content, not deletion. A future day-off record is still a
plan. Callers performing writes hold the scheduling gate/date/row locks before
loading this state; preview remains advisory.
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.scheduling.models import ScheduleDefinition, SessionDefinition


@dataclass
class WeekdayTimeline:
    current: ScheduleDefinition | None
    planned: ScheduleDefinition | None
    predecessor: ScheduleDefinition | None
    successor: ScheduleDefinition | None
    sessions: dict[UUID, list[SessionDefinition]]

    def working_sessions(self, definition: ScheduleDefinition | None) -> list[SessionDefinition]:
        if definition is None or not definition.active:
            return []
        return [s for s in self.sessions[definition.schedule_definition_id] if s.active]

    def fingerprint(self) -> str:
        roles = {}
        for role in ("current", "planned", "predecessor", "successor"):
            definition = getattr(self, role)
            if definition is None:
                roles[role] = None
                continue
            if role == "successor":
                # Only its identity/start bounds this edit. Independent later
                # working/off content and its own end date are outside the scope.
                roles[role] = {
                    "id": str(definition.schedule_definition_id),
                    "effective_from": definition.effective_from.isoformat(),
                }
                continue
            state = {
                "id": str(definition.schedule_definition_id),
                "weekday": definition.weekday,
                "active": definition.active,
                "version": definition.version,
                "effective_from": definition.effective_from.isoformat(),
                "effective_to": definition.effective_to.isoformat()
                if definition.effective_to
                else None,
            }
            state["sessions"] = [
                {
                    "id": str(s.session_definition_id),
                    "session_name": s.session_name,
                    "start_time": s.start_time.isoformat(),
                    "end_time": s.end_time.isoformat(),
                    "slot_interval_minutes": s.slot_interval_minutes,
                    "maximum_capacity": s.maximum_capacity,
                    "active": s.active,
                    "display_order": s.display_order,
                }
                for s in sorted(
                    self.sessions[definition.schedule_definition_id],
                    key=lambda s: (s.display_order, str(s.session_definition_id)),
                )
            ]
            roles[role] = state
        encoded = json.dumps(roles, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return "sha256:" + hashlib.sha256(encoded).hexdigest()


def load_weekday_timeline(
    db: Session,
    clinic_id: UUID,
    doctor_id: UUID,
    weekday: int,
    today: date,
) -> WeekdayTimeline:
    definitions = list(
        db.scalars(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.clinic_id == clinic_id,
                ScheduleDefinition.doctor_id == doctor_id,
                ScheduleDefinition.weekday == weekday,
            )
            .order_by(ScheduleDefinition.effective_from)
            .execution_options(populate_existing=True)
        ).all()
    )
    current = next(
        (
            d
            for d in reversed(definitions)
            if d.effective_from <= today and (d.effective_to is None or d.effective_to >= today)
        ),
        None,
    )
    planned = next((d for d in definitions if d.effective_from > today), None)
    predecessor = (
        next((d for d in reversed(definitions) if d.effective_from < planned.effective_from), None)
        if planned
        else current
    )
    successor = (
        next((d for d in definitions if d.effective_from > planned.effective_from), None)
        if planned
        else None
    )
    relevant = {d.schedule_definition_id for d in (current, planned, predecessor) if d is not None}
    sessions: dict[UUID, list[SessionDefinition]] = {key: [] for key in relevant}
    if relevant:
        for session in db.scalars(
            select(SessionDefinition)
            .where(
                SessionDefinition.clinic_id == clinic_id,
                SessionDefinition.schedule_definition_id.in_(relevant),
            )
            .order_by(SessionDefinition.display_order, SessionDefinition.session_definition_id)
            .execution_options(populate_existing=True)
        ).all():
            sessions[session.schedule_definition_id].append(session)
    return WeekdayTimeline(current, planned, predecessor, successor, sessions)
