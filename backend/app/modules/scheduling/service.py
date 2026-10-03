from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.context import request_id_var
from app.core.errors import AppError
from app.modules.audit.service import AuditService
from app.modules.clinic.models import Doctor
from app.modules.identity.service import AuthContext
from app.modules.scheduling.models import (
    FeeConfiguration,
    ScheduleDefinition,
    SessionDefinition,
    SessionOccurrence,
)
from app.modules.scheduling.schemas import (
    AvailabilityResponse,
    AvailabilitySession,
    AvailabilitySlot,
    BlockSessionRequest,
    FeeConfigurationCreateRequest,
    FeeConfigurationResponse,
    ScheduleDefinitionResponse,
    ScheduleReplaceRequest,
    SessionDefinitionResponse,
    SessionOccurrenceResponse,
    WeeklyScheduleResponse,
)


def _request_id() -> UUID:
    value = request_id_var.get()
    if value is None:  # pragma: no cover - middleware invariant
        raise RuntimeError("request id missing")
    return UUID(value)


def generate_slots(start: time, end: time, interval_minutes: int) -> list[time]:
    anchor = date(2000, 1, 1)
    current = datetime.combine(anchor, start)
    finish = datetime.combine(anchor, end)
    slots: list[time] = []
    while current + timedelta(minutes=interval_minutes) <= finish:
        slots.append(current.time())
        current += timedelta(minutes=interval_minutes)
    return slots


class SchedulingService:
    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def weekly_schedule(self, doctor_id: UUID, effective_on: date | None = None) -> WeeklyScheduleResponse:
        effective_on = effective_on or self.clock.clinic_date()
        self._doctor(doctor_id)
        definitions = self.db.scalars(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.clinic_id == self.context.clinic_id,
                ScheduleDefinition.doctor_id == doctor_id,
                ScheduleDefinition.active.is_(True),
                ScheduleDefinition.effective_from <= effective_on,
                or_(
                    ScheduleDefinition.effective_to.is_(None),
                    ScheduleDefinition.effective_to >= effective_on,
                ),
            )
            .order_by(ScheduleDefinition.weekday)
        ).all()
        return WeeklyScheduleResponse(
            doctor_id=doctor_id,
            effective_on=effective_on,
            days=[self._schedule_response(item) for item in definitions],
        )

    def replace_weekday(
        self, doctor_id: UUID, weekday: int, request: ScheduleReplaceRequest
    ) -> ScheduleDefinitionResponse:
        if weekday < 0 or weekday > 6:
            raise AppError("INVALID_WEEKDAY", "Weekday must be between 0 and 6.", 422)
        self._doctor(doctor_id)
        if request.effective_from < self.clock.clinic_date():
            raise AppError(
                "SCHEDULE_EFFECTIVE_DATE_PAST",
                "Schedule changes cannot start before the clinic's current date.",
                422,
            )

        future = self.db.scalar(
            select(ScheduleDefinition).where(
                ScheduleDefinition.clinic_id == self.context.clinic_id,
                ScheduleDefinition.doctor_id == doctor_id,
                ScheduleDefinition.weekday == weekday,
                ScheduleDefinition.effective_from >= request.effective_from,
            )
        )
        if future is not None:
            raise AppError(
                "SCHEDULE_EFFECTIVE_DATE_CONFLICT",
                "A schedule version already starts on or after this date.",
                409,
            )

        current = self.db.scalar(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.clinic_id == self.context.clinic_id,
                ScheduleDefinition.doctor_id == doctor_id,
                ScheduleDefinition.weekday == weekday,
                ScheduleDefinition.effective_from < request.effective_from,
                or_(
                    ScheduleDefinition.effective_to.is_(None),
                    ScheduleDefinition.effective_to >= request.effective_from,
                ),
            )
            .order_by(ScheduleDefinition.effective_from.desc())
            .with_for_update()
        )
        latest_version = self.db.scalar(
            select(func.max(ScheduleDefinition.version)).where(
                ScheduleDefinition.clinic_id == self.context.clinic_id,
                ScheduleDefinition.doctor_id == doctor_id,
                ScheduleDefinition.weekday == weekday,
            )
        )
        next_version = (latest_version or 0) + 1
        if current is not None:
            current.effective_to = request.effective_from - timedelta(days=1)

        definition = ScheduleDefinition(
            clinic_id=self.context.clinic_id,
            doctor_id=doctor_id,
            weekday=weekday,
            effective_from=request.effective_from,
            active=bool(request.sessions),
            version=next_version,
            created_by=self.context.user_id,
        )
        self.db.add(definition)
        self.db.flush()
        for session in request.sessions:
            self.db.add(
                SessionDefinition(
                    clinic_id=self.context.clinic_id,
                    schedule_definition_id=definition.schedule_definition_id,
                    session_name=session.session_name.strip(),
                    start_time=session.start_time,
                    end_time=session.end_time,
                    slot_interval_minutes=session.slot_interval_minutes,
                    maximum_capacity=session.maximum_capacity,
                    active=session.active,
                    display_order=session.display_order,
                )
            )
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="SCHEDULE_VERSION_CREATED",
            entity_type="SCHEDULE_DEFINITION",
            entity_id=definition.schedule_definition_id,
            request_id=_request_id(),
            new_values={
                "doctor_id": str(doctor_id),
                "weekday": weekday,
                "effective_from": request.effective_from.isoformat(),
                "session_count": len(request.sessions),
            },
        )
        return self._schedule_response(definition)

    def availability(self, doctor_id: UUID, target_date: date) -> AvailabilityResponse:
        self._doctor(doctor_id)
        definition = self.db.scalar(
            select(ScheduleDefinition).where(
                ScheduleDefinition.clinic_id == self.context.clinic_id,
                ScheduleDefinition.doctor_id == doctor_id,
                ScheduleDefinition.weekday == target_date.weekday(),
                ScheduleDefinition.active.is_(True),
                ScheduleDefinition.effective_from <= target_date,
                or_(
                    ScheduleDefinition.effective_to.is_(None),
                    ScheduleDefinition.effective_to >= target_date,
                ),
            )
        )
        if definition is None:
            return AvailabilityResponse(doctor_id=doctor_id, date=target_date, sessions=[])

        sessions = self.db.scalars(
            select(SessionDefinition)
            .where(
                SessionDefinition.schedule_definition_id == definition.schedule_definition_id,
                SessionDefinition.active.is_(True),
            )
            .order_by(SessionDefinition.display_order, SessionDefinition.start_time)
        ).all()
        occurrences = {
            item.session_definition_id: item
            for item in self.db.scalars(
                select(SessionOccurrence).where(
                    SessionOccurrence.clinic_id == self.context.clinic_id,
                    SessionOccurrence.occurrence_date == target_date,
                    SessionOccurrence.session_definition_id.in_(
                        [session.session_definition_id for session in sessions]
                    ),
                )
            ).all()
        } if sessions else {}

        result: list[AvailabilitySession] = []
        for session in sessions:
            occurrence = occurrences.get(session.session_definition_id)
            status = occurrence.status if occurrence is not None else "AVAILABLE"
            start = occurrence.start_time_snapshot if occurrence else session.start_time
            end = occurrence.end_time_snapshot if occurrence else session.end_time
            interval = (
                occurrence.slot_interval_minutes_snapshot
                if occurrence
                else session.slot_interval_minutes
            )
            capacity = occurrence.maximum_capacity_snapshot if occurrence else session.maximum_capacity
            # M4 plugs Appointment occupancy into this read model. M3 has no appointment table yet.
            used_capacity = 0
            remaining = max(capacity - used_capacity, 0)
            sendable = status == "AVAILABLE" and remaining > 0
            result.append(
                AvailabilitySession(
                    session_occurrence_id=(occurrence.session_occurrence_id if occurrence else None),
                    session_definition_id=session.session_definition_id,
                    materialized=occurrence is not None,
                    name=(occurrence.session_name_snapshot if occurrence else session.session_name),
                    start_time=start,
                    end_time=end,
                    status=status,
                    slot_interval_minutes=interval,
                    maximum_capacity=capacity,
                    used_capacity=used_capacity,
                    remaining_capacity=remaining,
                    blocked_reason=(occurrence.block_reason if occurrence else None),
                    slots=[
                        AvailabilitySlot(
                            time=value,
                            available=sendable,
                            normal_booking_allowed=sendable,
                        )
                        for value in generate_slots(start, end, interval)
                    ],
                )
            )
        return AvailabilityResponse(doctor_id=doctor_id, date=target_date, sessions=result)

    def block(self, request: BlockSessionRequest) -> SessionOccurrenceResponse:
        occurrence = self.materialize_occurrence(request.session_definition_id, request.date)
        occurrence = self.db.scalar(
            select(SessionOccurrence)
            .where(SessionOccurrence.session_occurrence_id == occurrence.session_occurrence_id)
            .with_for_update()
        )
        if occurrence is None:  # pragma: no cover
            raise RuntimeError("Occurrence disappeared while blocking")
        if occurrence.status == "BLOCKED":
            raise AppError("SESSION_ALREADY_BLOCKED", "This session is already blocked.", 409)
        occurrence.status = "BLOCKED"
        occurrence.block_reason = request.reason.strip()
        occurrence.blocked_by = self.context.user_id
        occurrence.blocked_at = self.clock.now_utc()
        occurrence.version += 1
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="SESSION_BLOCKED",
            entity_type="SESSION_OCCURRENCE",
            entity_id=occurrence.session_occurrence_id,
            request_id=_request_id(),
            reason=occurrence.block_reason,
            new_values={"status": "BLOCKED", "date": occurrence.occurrence_date.isoformat()},
        )
        return self._occurrence_response(occurrence)

    def unblock(self, occurrence_id: UUID) -> SessionOccurrenceResponse:
        occurrence = self.db.scalar(
            select(SessionOccurrence)
            .where(
                SessionOccurrence.session_occurrence_id == occurrence_id,
                SessionOccurrence.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if occurrence is None:
            raise AppError("SESSION_OCCURRENCE_NOT_FOUND", "Session occurrence not found.", 404)
        if occurrence.status != "BLOCKED":
            raise AppError("SESSION_NOT_BLOCKED", "This session is not blocked.", 409)
        occurrence.status = "AVAILABLE"
        occurrence.block_reason = None
        occurrence.blocked_by = None
        occurrence.blocked_at = None
        occurrence.version += 1
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="SESSION_UNBLOCKED",
            entity_type="SESSION_OCCURRENCE",
            entity_id=occurrence.session_occurrence_id,
            request_id=_request_id(),
            new_values={"status": "AVAILABLE", "date": occurrence.occurrence_date.isoformat()},
        )
        return self._occurrence_response(occurrence)

    def materialize_occurrence(self, session_definition_id: UUID, target_date: date) -> SessionOccurrence:
        row = self.db.execute(
            select(SessionDefinition, ScheduleDefinition)
            .join(
                ScheduleDefinition,
                ScheduleDefinition.schedule_definition_id == SessionDefinition.schedule_definition_id,
            )
            .where(
                SessionDefinition.session_definition_id == session_definition_id,
                SessionDefinition.clinic_id == self.context.clinic_id,
                SessionDefinition.active.is_(True),
                ScheduleDefinition.clinic_id == self.context.clinic_id,
                ScheduleDefinition.active.is_(True),
            )
        ).one_or_none()
        if row is None:
            raise AppError("SESSION_DEFINITION_NOT_FOUND", "Session definition not found.", 404)
        session_definition, schedule = row
        if (
            target_date.weekday() != schedule.weekday
            or target_date < schedule.effective_from
            or (schedule.effective_to is not None and target_date > schedule.effective_to)
        ):
            raise AppError(
                "SESSION_NOT_VALID_FOR_DATE",
                "This session is not configured for the selected date.",
                422,
            )

        values = {
            "session_occurrence_id": uuid4(),
            "clinic_id": self.context.clinic_id,
            "doctor_id": schedule.doctor_id,
            "session_definition_id": session_definition.session_definition_id,
            "occurrence_date": target_date,
            "session_name_snapshot": session_definition.session_name,
            "start_time_snapshot": session_definition.start_time,
            "end_time_snapshot": session_definition.end_time,
            "slot_interval_minutes_snapshot": session_definition.slot_interval_minutes,
            "maximum_capacity_snapshot": session_definition.maximum_capacity,
            "status": "AVAILABLE",
            "version": 1,
        }
        self.db.execute(
            pg_insert(SessionOccurrence)
            .values(**values)
            .on_conflict_do_nothing(index_elements=["session_definition_id", "occurrence_date"])
        )
        occurrence = self.db.scalar(
            select(SessionOccurrence).where(
                SessionOccurrence.session_definition_id == session_definition_id,
                SessionOccurrence.occurrence_date == target_date,
                SessionOccurrence.clinic_id == self.context.clinic_id,
            )
        )
        if occurrence is None:  # pragma: no cover
            raise RuntimeError("Session occurrence could not be materialized")
        return occurrence

    def current_fee(self, as_of: date | None = None) -> FeeConfigurationResponse:
        as_of = as_of or self.clock.clinic_date()
        fee = self.db.scalar(
            select(FeeConfiguration).where(
                FeeConfiguration.clinic_id == self.context.clinic_id,
                FeeConfiguration.effective_from <= as_of,
                or_(FeeConfiguration.effective_to.is_(None), FeeConfiguration.effective_to >= as_of),
            )
        )
        if fee is None:
            raise AppError("FEE_CONFIGURATION_NOT_FOUND", "Clinic fees are not configured yet.", 404)
        return self._fee_response(fee)

    def create_fee_configuration(
        self, request: FeeConfigurationCreateRequest
    ) -> FeeConfigurationResponse:
        if request.effective_from < self.clock.clinic_date():
            raise AppError(
                "FEE_EFFECTIVE_DATE_PAST",
                "Fee changes cannot start before the clinic's current date.",
                422,
            )
        future = self.db.scalar(
            select(FeeConfiguration).where(
                FeeConfiguration.clinic_id == self.context.clinic_id,
                FeeConfiguration.effective_from >= request.effective_from,
            )
        )
        if future is not None:
            raise AppError(
                "FEE_EFFECTIVE_DATE_CONFLICT",
                "A fee configuration already starts on or after this date.",
                409,
            )
        current = self.db.scalar(
            select(FeeConfiguration)
            .where(
                FeeConfiguration.clinic_id == self.context.clinic_id,
                FeeConfiguration.effective_from < request.effective_from,
                or_(
                    FeeConfiguration.effective_to.is_(None),
                    FeeConfiguration.effective_to >= request.effective_from,
                ),
            )
            .order_by(FeeConfiguration.effective_from.desc())
            .with_for_update()
        )
        if current is not None:
            current.effective_to = request.effective_from - timedelta(days=1)

        fee = FeeConfiguration(
            clinic_id=self.context.clinic_id,
            effective_from=request.effective_from,
            regular_fee=Decimal(request.regular_fee),
            followup_fee=Decimal(request.followup_fee),
            assistant_adjustment_allowed=request.assistant_adjustment_allowed,
            created_by=self.context.user_id,
        )
        self.db.add(fee)
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="FEE_CONFIG_CHANGED",
            entity_type="FEE_CONFIGURATION",
            entity_id=fee.fee_configuration_id,
            request_id=_request_id(),
            new_values={
                "effective_from": fee.effective_from.isoformat(),
                "regular_fee": str(fee.regular_fee),
                "followup_fee": str(fee.followup_fee),
                "assistant_adjustment_allowed": fee.assistant_adjustment_allowed,
            },
        )
        return self._fee_response(fee)

    def _doctor(self, doctor_id: UUID) -> Doctor:
        doctor = self.db.scalar(
            select(Doctor).where(
                Doctor.doctor_id == doctor_id,
                Doctor.clinic_id == self.context.clinic_id,
                Doctor.active.is_(True),
            )
        )
        if doctor is None:
            raise AppError("DOCTOR_NOT_FOUND", "Doctor not found.", 404)
        return doctor

    def _schedule_response(self, definition: ScheduleDefinition) -> ScheduleDefinitionResponse:
        sessions = self.db.scalars(
            select(SessionDefinition)
            .where(SessionDefinition.schedule_definition_id == definition.schedule_definition_id)
            .order_by(SessionDefinition.display_order, SessionDefinition.start_time)
        ).all()
        return ScheduleDefinitionResponse(
            schedule_definition_id=definition.schedule_definition_id,
            doctor_id=definition.doctor_id,
            weekday=definition.weekday,
            effective_from=definition.effective_from,
            effective_to=definition.effective_to,
            active=definition.active,
            version=definition.version,
            sessions=[
                SessionDefinitionResponse(
                    session_definition_id=item.session_definition_id,
                    session_name=item.session_name,
                    start_time=item.start_time,
                    end_time=item.end_time,
                    slot_interval_minutes=item.slot_interval_minutes,
                    maximum_capacity=item.maximum_capacity,
                    active=item.active,
                    display_order=item.display_order,
                )
                for item in sessions
            ],
        )

    @staticmethod
    def _occurrence_response(item: SessionOccurrence) -> SessionOccurrenceResponse:
        return SessionOccurrenceResponse(
            session_occurrence_id=item.session_occurrence_id,
            session_definition_id=item.session_definition_id,
            doctor_id=item.doctor_id,
            date=item.occurrence_date,
            name=item.session_name_snapshot,
            start_time=item.start_time_snapshot,
            end_time=item.end_time_snapshot,
            slot_interval_minutes=item.slot_interval_minutes_snapshot,
            maximum_capacity=item.maximum_capacity_snapshot,
            status=item.status,
            block_reason=item.block_reason,
            version=item.version,
        )

    @staticmethod
    def _fee_response(item: FeeConfiguration) -> FeeConfigurationResponse:
        return FeeConfigurationResponse(
            fee_configuration_id=item.fee_configuration_id,
            effective_from=item.effective_from,
            effective_to=item.effective_to,
            regular_fee=item.regular_fee,
            followup_fee=item.followup_fee,
            assistant_adjustment_allowed=item.assistant_adjustment_allowed,
        )
