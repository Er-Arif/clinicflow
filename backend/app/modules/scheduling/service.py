from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import jwt
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import settings
from app.core.context import request_id_var
from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.audit.service import AuditService
from app.modules.clinic.models import Doctor
from app.modules.identity.service import AuthContext
from app.modules.scheduling.concurrency import acquire_doctor_date_locks
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
    BlockScheduleExceptionRequest,
    BlockSessionRequest,
    DayImpactResponse,
    FeeConfigurationCreateRequest,
    FeeConfigurationResponse,
    MultiDayScheduleReplaceRequest,
    ScheduleDefinitionResponse,
    ScheduleExceptionResponse,
    ScheduleExceptionsListResponse,
    ScheduleOverviewResponse,
    SchedulePreviewImpactRequest,
    SchedulePreviewImpactResponse,
    ScheduleReplaceRequest,
    SessionDefinitionResponse,
    SessionOccurrenceResponse,
    SessionWrite,
    SmartScheduleApplyRequest,
    UnblockScheduleExceptionRequest,
    UnblockScheduleExceptionResponse,
    WeekdayOverviewResponse,
    WeeklyScheduleResponse,
)


def _request_id() -> UUID:
    value = request_id_var.get()
    if value is None:  # pragma: no cover - middleware invariant
        raise RuntimeError("request id missing")
    return UUID(value)


def _normalize_proposal_hash(weekdays: list[int], sessions: list[SessionWrite]) -> str:
    sorted_weekdays = sorted(weekdays)
    sorted_sessions = sorted(sessions, key=lambda s: s.display_order)
    canonical = {
        "weekdays": sorted_weekdays,
        "sessions": [
            {
                "display_order": s.display_order,
                "session_name": s.session_name.strip(),
                "start_time": s.start_time.strftime("%H:%M:%S"),
                "end_time": s.end_time.strftime("%H:%M:%S"),
                "slot_interval_minutes": s.slot_interval_minutes,
                "maximum_capacity": s.maximum_capacity,
                "active": s.active,
            }
            for s in sorted_sessions
        ],
    }
    dumped = json.dumps(canonical, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()


def _proposal_token_secret() -> str:
    # Purpose-separated signing key derived from access_token_secret to isolate proposal tokens from auth tokens
    return hashlib.sha256(f"schedule_proposal_v1:{settings.access_token_secret}".encode()).hexdigest()


def _create_proposal_token(
    clinic_id: UUID,
    doctor_id: UUID,
    payload_hash: str,
    weekdays: list[int],
    expected_states: dict[str, Any],
    now: datetime,
) -> str:
    expires = now + timedelta(minutes=10)
    claims = {
        "sub": str(doctor_id),
        "cid": str(clinic_id),
        "phash": payload_hash,
        "weekdays": sorted(weekdays),
        "expected_states": expected_states,
        "iat": now,
        "exp": expires,
        "typ": "schedule_proposal",
    }
    return jwt.encode(claims, _proposal_token_secret(), algorithm=settings.jwt_algorithm)


def _decode_and_verify_proposal_token(
    token: str,
    clinic_id: UUID,
    doctor_id: UUID,
    expected_payload_hash: str,
    now: datetime,
) -> dict[str, Any]:
    try:
        claims = jwt.decode(
            token,
            _proposal_token_secret(),
            algorithms=[settings.jwt_algorithm],
            options={
                "verify_exp": False,
                "verify_iat": False,
                "require": ["sub", "cid", "phash", "weekdays", "expected_states", "exp", "iat"],
            },
        )
    except jwt.PyJWTError as exc:
        raise AppError(
            code="STALE_SCHEDULE_PREVIEW",
            message="Invalid schedule proposal token.",
            status_code=409,
        ) from exc

    exp = claims.get("exp")
    if exp is not None and int(now.timestamp()) > exp:
        raise AppError(
            code="STALE_SCHEDULE_PREVIEW",
            message="Schedule proposal has expired. Please review and apply again.",
            status_code=409,
        )

    if claims.get("typ") != "schedule_proposal":
        raise AppError(
            code="STALE_SCHEDULE_PREVIEW",
            message="Invalid token type.",
            status_code=409,
        )
    if claims.get("cid") != str(clinic_id) or claims.get("sub") != str(doctor_id):
        raise AppError(
            code="STALE_SCHEDULE_PREVIEW",
            message="Proposal token does not match doctor or clinic.",
            status_code=409,
        )
    if claims.get("phash") != expected_payload_hash:
        raise AppError(
            code="STALE_SCHEDULE_PREVIEW",
            message="Proposal payload does not match preview.",
            status_code=409,
        )
    return claims


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

    def schedule_overview(self, doctor_id: UUID) -> ScheduleOverviewResponse:
        self._doctor(doctor_id)
        effective_on = self.clock.clinic_date()

        all_defs = self.db.scalars(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.clinic_id == self.context.clinic_id,
                ScheduleDefinition.doctor_id == doctor_id,
                ScheduleDefinition.active.is_(True),
            )
            .order_by(ScheduleDefinition.weekday, ScheduleDefinition.effective_from)
        ).all()

        weekday_defs: dict[int, list[ScheduleDefinition]] = {w: [] for w in range(7)}
        for item in all_defs:
            weekday_defs[item.weekday].append(item)

        weekday_responses: list[WeekdayOverviewResponse] = []
        weekday_names = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
        ]

        for w in range(7):
            defs = weekday_defs[w]
            current_candidates = [
                d
                for d in defs
                if d.effective_from <= effective_on
                and (d.effective_to is None or d.effective_to >= effective_on)
            ]
            current_def = (
                max(current_candidates, key=lambda d: d.effective_from)
                if current_candidates
                else None
            )

            upcoming_candidates = [d for d in defs if d.effective_from > effective_on]
            upcoming_def = (
                min(upcoming_candidates, key=lambda d: d.effective_from)
                if upcoming_candidates
                else None
            )

            weekday_responses.append(
                WeekdayOverviewResponse(
                    weekday=w,
                    weekday_name=weekday_names[w],
                    current=self._schedule_response(current_def) if current_def else None,
                    upcoming=self._schedule_response(upcoming_def) if upcoming_def else None,
                )
            )

        return ScheduleOverviewResponse(
            doctor_id=doctor_id,
            effective_on=effective_on,
            days=weekday_responses,
        )

    def _evaluate_weekday_safe_date(
        self,
        doctor_id: UUID,
        weekday: int,
        proposed_sessions: list[SessionWrite],
    ) -> tuple[
        date,
        str,
        bool,
        int,
        dict[str, Any] | None,
        ScheduleDefinition | None,
        ScheduleDefinition | None,
    ]:
        t_clinic = self.clock.clinic_date()
        clock_now = self.clock.clinic_now().time()

        defs = self.db.scalars(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.clinic_id == self.context.clinic_id,
                ScheduleDefinition.doctor_id == doctor_id,
                ScheduleDefinition.weekday == weekday,
                ScheduleDefinition.active.is_(True),
            )
            .order_by(ScheduleDefinition.effective_from.desc())
        ).all()

        current_candidates = [
            d
            for d in defs
            if d.effective_from <= t_clinic
            and (d.effective_to is None or d.effective_to >= t_clinic)
        ]
        def_active = (
            max(current_candidates, key=lambda d: d.effective_from)
            if current_candidates
            else None
        )

        upcoming_candidates = [d for d in defs if d.effective_from > t_clinic]
        def_upcoming = (
            min(upcoming_candidates, key=lambda d: d.effective_from)
            if upcoming_candidates
            else None
        )

        initial_reason: str
        d_candidate: date

        if def_upcoming is not None:
            d_candidate = def_upcoming.effective_from
            initial_reason = (
                f"Updates upcoming schedule change planned from "
                f"{def_upcoming.effective_from.strftime('%d %b %Y')}."
            )
        elif def_active is not None and def_active.effective_from == t_clinic:
            # One-change-per-day rule: today has already received a new schedule version
            delta = (weekday - t_clinic.weekday()) % 7
            if delta == 0:
                delta = 7
            d_candidate = t_clinic + timedelta(days=delta)
            initial_reason = (
                f"Today's working hours were already updated. "
                f"This additional change will apply from {d_candidate.strftime('%d %b %Y')}."
            )
        elif weekday == t_clinic.weekday():
            # Same-day evaluation: check affected sessions
            active_sessions = (
                list(
                    self.db.scalars(
                        select(SessionDefinition)
                        .where(
                            SessionDefinition.schedule_definition_id
                            == def_active.schedule_definition_id,
                            SessionDefinition.active.is_(True),
                        )
                        .order_by(SessionDefinition.display_order, SessionDefinition.start_time)
                    ).all()
                )
                if def_active
                else []
            )

            can_apply_today = True
            unstarted_reason = ""

            today_blocked = self.db.scalar(
                select(func.count(SessionOccurrence.session_occurrence_id)).where(
                    SessionOccurrence.clinic_id == self.context.clinic_id,
                    SessionOccurrence.doctor_id == doctor_id,
                    SessionOccurrence.occurrence_date == t_clinic,
                    SessionOccurrence.status == "BLOCKED",
                )
            )
            if today_blocked and today_blocked > 0:
                can_apply_today = False
                unstarted_reason = "Today has blocked sessions."

            active_by_order = {s.display_order: s for s in active_sessions}
            proposed_by_order = {s.display_order: s for s in proposed_sessions if s.active}

            # Check modified or removed sessions
            for order, act_s in active_by_order.items():
                if order in proposed_by_order:
                    prop_s = proposed_by_order[order]
                    is_modified = (
                        act_s.start_time != prop_s.start_time
                        or act_s.end_time != prop_s.end_time
                        or act_s.slot_interval_minutes != prop_s.slot_interval_minutes
                        or act_s.maximum_capacity != prop_s.maximum_capacity
                    )
                    if is_modified and (clock_now >= act_s.start_time or clock_now >= prop_s.start_time):
                        can_apply_today = False
                        unstarted_reason = "Today's clinic hours have already started or passed."
                        break
                else:
                    if clock_now >= act_s.start_time:
                        can_apply_today = False
                        unstarted_reason = "Cannot remove a session that has already started or completed today."
                        break
                    booked_in_removed = self.db.scalar(
                        select(func.count(Appointment.appointment_id))
                        .join(
                            SessionOccurrence,
                            SessionOccurrence.session_occurrence_id
                            == Appointment.session_occurrence_id,
                        )
                        .where(
                            SessionOccurrence.clinic_id == self.context.clinic_id,
                            SessionOccurrence.occurrence_date == t_clinic,
                            SessionOccurrence.session_definition_id
                            == act_s.session_definition_id,
                            Appointment.status != "CANCELLED",
                        )
                    )
                    if booked_in_removed and booked_in_removed > 0:
                        can_apply_today = False
                        unstarted_reason = "Cannot remove a session with existing bookings today."
                        break

            if can_apply_today:
                for order, prop_s in proposed_by_order.items():
                    if order not in active_by_order and clock_now >= prop_s.start_time:
                        can_apply_today = False
                        unstarted_reason = "Proposed session start time has already passed today."
                        break

            if can_apply_today:
                d_candidate = t_clinic
                initial_reason = "Applies immediately today."
            else:
                d_candidate = t_clinic + timedelta(days=7)
                initial_reason = (
                    f"{unstarted_reason} Applies from {d_candidate.strftime('%d %b %Y')}."
                )
        else:
            delta = (weekday - t_clinic.weekday()) % 7
            if delta == 0:
                delta = 7
            d_candidate = t_clinic + timedelta(days=delta)
            initial_reason = f"Applies from {d_candidate.strftime('%d %b %Y')}."

        # Scan for appointment conflicts across deterministic horizon
        latest_booking_date = self.db.scalar(
            select(func.max(SessionOccurrence.occurrence_date))
            .join(
                Appointment,
                Appointment.session_occurrence_id == SessionOccurrence.session_occurrence_id,
            )
            .where(
                Appointment.clinic_id == self.context.clinic_id,
                Appointment.doctor_id == doctor_id,
                Appointment.status != "CANCELLED",
                func.extract("dow", SessionOccurrence.occurrence_date) == ((weekday + 1) % 7),
            )
        )

        horizon_limit = t_clinic + timedelta(days=30)
        if latest_booking_date and (latest_booking_date + timedelta(days=7)) > horizon_limit:
            horizon_limit = latest_booking_date + timedelta(days=7)

        latest_blocked_date = self.db.scalar(
            select(func.max(SessionOccurrence.occurrence_date)).where(
                SessionOccurrence.clinic_id == self.context.clinic_id,
                SessionOccurrence.doctor_id == doctor_id,
                SessionOccurrence.status == "BLOCKED",
                func.extract("dow", SessionOccurrence.occurrence_date) == ((weekday + 1) % 7),
            )
        )
        if latest_blocked_date and (latest_blocked_date + timedelta(days=7)) > horizon_limit:
            horizon_limit = latest_blocked_date + timedelta(days=7)

        curr = d_candidate
        conflict_detected = False
        total_conflicts_count = 0
        conflict_metadata: dict[str, Any] | None = None
        safe_date = d_candidate

        while curr <= horizon_limit:
            blocked_count = self.db.scalar(
                select(func.count(SessionOccurrence.session_occurrence_id)).where(
                    SessionOccurrence.clinic_id == self.context.clinic_id,
                    SessionOccurrence.doctor_id == doctor_id,
                    SessionOccurrence.occurrence_date == curr,
                    SessionOccurrence.status == "BLOCKED",
                )
            )

            appts = list(
                self.db.scalars(
                    select(Appointment)
                    .join(
                        SessionOccurrence,
                        SessionOccurrence.session_occurrence_id
                        == Appointment.session_occurrence_id,
                    )
                    .where(
                        Appointment.clinic_id == self.context.clinic_id,
                        Appointment.doctor_id == doctor_id,
                        Appointment.status != "CANCELLED",
                        SessionOccurrence.occurrence_date == curr,
                    )
                ).all()
            )

            date_conflict = False
            date_conflict_msg = ""
            active_proposed = [s for s in proposed_sessions if s.active]

            if blocked_count and blocked_count > 0:
                date_conflict = True
                date_conflict_msg = f"{blocked_count} session(s) blocked on this date."
            elif not active_proposed and appts:
                date_conflict = True
                date_conflict_msg = f"{len(appts)} existing appointment(s) booked on day marked not working."
            elif active_proposed and appts:
                session_counts: dict[int, int] = {i: 0 for i in range(len(active_proposed))}
                for appt in appts:
                    appt_time = appt.appointment_time
                    if appt_time is None:
                        continue
                    matching_idx = None
                    for idx, s in enumerate(active_proposed):
                        if s.start_time <= appt_time < s.end_time:
                            matching_idx = idx
                            break
                    if matching_idx is None:
                        date_conflict = True
                        date_conflict_msg = (
                            f"Appointment at {appt_time.strftime('%H:%M')} falls outside proposed hours."
                        )
                        break

                    match_sess = active_proposed[matching_idx]
                    start_min = match_sess.start_time.hour * 60 + match_sess.start_time.minute
                    appt_min = appt_time.hour * 60 + appt_time.minute
                    interval = match_sess.slot_interval_minutes
                    if (appt_min - start_min) % interval != 0:
                        date_conflict = True
                        date_conflict_msg = (
                            f"Appointment at {appt_time.strftime('%H:%M')} does not align with "
                            f"{interval}-minute slot intervals."
                        )
                        break

                    session_counts[matching_idx] += 1

                if not date_conflict:
                    for idx, s in enumerate(active_proposed):
                        if session_counts[idx] > s.maximum_capacity:
                            date_conflict = True
                            date_conflict_msg = (
                                f"Booked appointments ({session_counts[idx]}) exceed proposed "
                                f"capacity ({s.maximum_capacity}) for {s.session_name}."
                            )
                            break

            if date_conflict:
                conflict_detected = True
                total_conflicts_count += len(appts)
                if conflict_metadata is None:
                    conflict_metadata = {
                        "conflicting_date": curr.isoformat(),
                        "conflicting_appointments_count": len(appts),
                        "reason": date_conflict_msg,
                    }
                safe_date = max(safe_date, curr + timedelta(days=7))

            curr += timedelta(days=7)

        if safe_date > horizon_limit:
            raise AppError(
                code="UNRESOLVABLE_APPOINTMENT_CONFLICT",
                message=(
                    f"All upcoming occurrences through {horizon_limit.strftime('%d %b %Y')} "
                    f"have conflicting appointments."
                ),
                status_code=409,
                details={
                    "latest_conflicting_date": horizon_limit.isoformat(),
                    "conflicting_appointments_count": total_conflicts_count,
                    "suggested_action": "Reschedule conflicting appointments or select a date beyond the horizon.",
                },
            )
        if conflict_detected and conflict_metadata:
            reason = (
                f"Existing appointments on {conflict_metadata['conflicting_date']} conflict "
                f"({conflict_metadata['reason']}). Applies from {safe_date.strftime('%d %b %Y')}."
            )
        else:
            reason = initial_reason

        return (
            safe_date,
            reason,
            conflict_detected,
            total_conflicts_count,
            conflict_metadata,
            def_active,
            def_upcoming,
        )

    def preview_schedule_impact(
        self, doctor_id: UUID, request: SchedulePreviewImpactRequest
    ) -> SchedulePreviewImpactResponse:
        self._doctor(doctor_id)
        now = self.clock.now_utc()
        payload_hash = _normalize_proposal_hash(request.weekdays, request.sessions)

        impacts: list[DayImpactResponse] = []
        expected_states: dict[str, Any] = {}
        weekday_names = [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
            "Sunday",
        ]

        for weekday in sorted(request.weekdays):
            (
                safe_date,
                reason,
                conflict_detected,
                appt_count,
                conflict_meta,
                def_active,
                def_upcoming,
            ) = self._evaluate_weekday_safe_date(doctor_id, weekday, request.sessions)

            impacts.append(
                DayImpactResponse(
                    weekday=weekday,
                    weekday_name=weekday_names[weekday],
                    applies_from=safe_date,
                    reason=reason,
                    conflict_detected=conflict_detected,
                    existing_appointments_count=appt_count,
                    conflict_metadata=conflict_meta,
                )
            )
            expected_states[str(weekday)] = {
                "active_id": str(def_active.schedule_definition_id) if def_active else None,
                "active_version": def_active.version if def_active else None,
                "upcoming_id": str(def_upcoming.schedule_definition_id) if def_upcoming else None,
                "upcoming_version": def_upcoming.version if def_upcoming else None,
                "safe_date": safe_date.isoformat(),
            }

        token = _create_proposal_token(
            clinic_id=self.context.clinic_id,
            doctor_id=doctor_id,
            payload_hash=payload_hash,
            weekdays=request.weekdays,
            expected_states=expected_states,
            now=now,
        )

        return SchedulePreviewImpactResponse(
            proposal_token=token,
            evaluated_at=now,
            impacts=impacts,
        )

    def smart_apply_schedule(
        self, doctor_id: UUID, request: SmartScheduleApplyRequest
    ) -> ScheduleOverviewResponse:
        self._doctor(doctor_id)
        payload_hash = _normalize_proposal_hash(request.weekdays, request.sessions)

        now = self.clock.now_utc()

        # 1. Verify token signature, expiry, clinic, doctor, payload hash
        token_claims = _decode_and_verify_proposal_token(
            token=request.proposal_token,
            clinic_id=self.context.clinic_id,
            doctor_id=doctor_id,
            expected_payload_hash=payload_hash,
            now=now,
        )
        expected_states = token_claims["expected_states"]

        t_clinic = self.clock.clinic_date()

        # 2. Acquire doctor-date transaction advisory locks in deterministic order across horizon
        horizon_limit = t_clinic + timedelta(days=30)
        latest_booking_date = self.db.scalar(
            select(func.max(SessionOccurrence.occurrence_date))
            .join(
                Appointment,
                Appointment.session_occurrence_id == SessionOccurrence.session_occurrence_id,
            )
            .where(
                Appointment.clinic_id == self.context.clinic_id,
                Appointment.doctor_id == doctor_id,
                Appointment.status != "CANCELLED",
            )
        )
        if latest_booking_date and (latest_booking_date + timedelta(days=7)) > horizon_limit:
            horizon_limit = latest_booking_date + timedelta(days=7)

        latest_blocked_date = self.db.scalar(
            select(func.max(SessionOccurrence.occurrence_date)).where(
                SessionOccurrence.clinic_id == self.context.clinic_id,
                SessionOccurrence.doctor_id == doctor_id,
                SessionOccurrence.status == "BLOCKED",
            )
        )
        if latest_blocked_date and (latest_blocked_date + timedelta(days=7)) > horizon_limit:
            horizon_limit = latest_blocked_date + timedelta(days=7)

        dates_to_lock: list[date] = []
        for weekday in request.weekdays:
            delta = (weekday - t_clinic.weekday()) % 7
            cur = t_clinic + timedelta(days=delta)
            while cur <= horizon_limit:
                dates_to_lock.append(cur)
                cur += timedelta(days=7)

        acquire_doctor_date_locks(self.db, doctor_id, dates_to_lock)

        # 3. Acquire ScheduleDefinition row locks
        locked_defs = list(
            self.db.scalars(
                select(ScheduleDefinition)
                .where(
                    ScheduleDefinition.clinic_id == self.context.clinic_id,
                    ScheduleDefinition.doctor_id == doctor_id,
                    ScheduleDefinition.weekday.in_(request.weekdays),
                )
                .with_for_update()
            ).all()
        )

        # 3. Verify expected schedule identities & versions against locked DB state
        for weekday in request.weekdays:
            state = expected_states.get(str(weekday))
            if not state:
                raise AppError("STALE_SCHEDULE_PREVIEW", "Preview state missing for weekday.", 409)

            w_defs = [d for d in locked_defs if d.weekday == weekday and d.active]
            curr_active_cands = [
                d
                for d in w_defs
                if d.effective_from <= t_clinic
                and (d.effective_to is None or d.effective_to >= t_clinic)
            ]
            curr_active = (
                max(curr_active_cands, key=lambda d: d.effective_from)
                if curr_active_cands
                else None
            )

            curr_upcoming_cands = [d for d in w_defs if d.effective_from > t_clinic]
            curr_upcoming = (
                min(curr_upcoming_cands, key=lambda d: d.effective_from)
                if curr_upcoming_cands
                else None
            )

            curr_active_id = str(curr_active.schedule_definition_id) if curr_active else None
            curr_active_ver = curr_active.version if curr_active else None
            curr_upcoming_id = str(curr_upcoming.schedule_definition_id) if curr_upcoming else None
            curr_upcoming_ver = curr_upcoming.version if curr_upcoming else None

            if (
                curr_active_id != state["active_id"]
                or curr_active_ver != state["active_version"]
                or curr_upcoming_id != state["upcoming_id"]
                or curr_upcoming_ver != state["upcoming_version"]
            ):
                raise AppError(
                    code="STALE_SCHEDULE_PREVIEW",
                    message="Schedule has been modified by another user. Please review and apply again.",
                    status_code=409,
                )

        # 4. Rerun complete live conflict scan & safe-date calculation
        recomputed: dict[
            int,
            tuple[date, ScheduleDefinition | None, ScheduleDefinition | None],
        ] = {}
        for weekday in request.weekdays:
            (
                safe_date,
                _reason,
                _conflict,
                _count,
                _meta,
                def_active,
                def_upcoming,
            ) = self._evaluate_weekday_safe_date(doctor_id, weekday, request.sessions)
            expected_safe_date_str = expected_states[str(weekday)]["safe_date"]
            if safe_date.isoformat() != expected_safe_date_str:
                raise AppError(
                    code="STALE_SCHEDULE_PREVIEW",
                    message="Schedule conditions changed while reviewing. Please review updated timeline.",
                    status_code=409,
                )
            recomputed[weekday] = (safe_date, def_active, def_upcoming)

        # 5. Apply updates
        for weekday in sorted(request.weekdays):
            safe_date, def_active, def_upcoming = recomputed[weekday]

            if def_upcoming and safe_date == def_upcoming.effective_from:
                # Update future planned definition in-place
                def_upcoming.active = bool(request.sessions)
                existing_sessions = list(
                    self.db.scalars(
                        select(SessionDefinition)
                        .where(
                            SessionDefinition.schedule_definition_id
                            == def_upcoming.schedule_definition_id
                        )
                        .order_by(SessionDefinition.display_order, SessionDefinition.start_time)
                    ).all()
                )
                min_len = min(len(existing_sessions), len(request.sessions))
                for i in range(min_len):
                    sess = existing_sessions[i]
                    req_sess = request.sessions[i]
                    sess.session_name = req_sess.session_name.strip()
                    sess.start_time = req_sess.start_time
                    sess.end_time = req_sess.end_time
                    sess.slot_interval_minutes = req_sess.slot_interval_minutes
                    sess.maximum_capacity = req_sess.maximum_capacity
                    sess.active = req_sess.active
                    sess.display_order = req_sess.display_order

                if len(request.sessions) > len(existing_sessions):
                    for i in range(len(existing_sessions), len(request.sessions)):
                        req_sess = request.sessions[i]
                        self.db.add(
                            SessionDefinition(
                                clinic_id=self.context.clinic_id,
                                schedule_definition_id=def_upcoming.schedule_definition_id,
                                session_name=req_sess.session_name.strip(),
                                start_time=req_sess.start_time,
                                end_time=req_sess.end_time,
                                slot_interval_minutes=req_sess.slot_interval_minutes,
                                maximum_capacity=req_sess.maximum_capacity,
                                active=req_sess.active,
                                display_order=req_sess.display_order,
                            )
                        )
                elif len(existing_sessions) > len(request.sessions):
                    for i in range(len(request.sessions), len(existing_sessions)):
                        sess = existing_sessions[i]
                        occ_count = self.db.scalar(
                            select(func.count(SessionOccurrence.session_occurrence_id)).where(
                                SessionOccurrence.session_definition_id
                                == sess.session_definition_id
                            )
                        )
                        if occ_count == 0:
                            self.db.delete(sess)
                        else:
                            sess.active = False
                            sess.display_order = 1000 + i

                target_def = def_upcoming
            else:
                # Close active definition & create new business version
                if def_active:
                    def_active.effective_to = safe_date - timedelta(days=1)
                    next_version = def_active.version + 1
                else:
                    next_version = 1

                target_def = ScheduleDefinition(
                    clinic_id=self.context.clinic_id,
                    doctor_id=doctor_id,
                    weekday=weekday,
                    effective_from=safe_date,
                    effective_to=None,
                    active=bool(request.sessions),
                    version=next_version,
                    created_by=self.context.user_id,
                )
                self.db.add(target_def)
                self.db.flush()

                for session in request.sessions:
                    self.db.add(
                        SessionDefinition(
                            clinic_id=self.context.clinic_id,
                            schedule_definition_id=target_def.schedule_definition_id,
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

                # Clean up unbooked AVAILABLE occurrences on dates >= safe_date
                unbooked_subquery = (
                    select(SessionOccurrence.session_occurrence_id)
                    .join(
                        SessionDefinition,
                        SessionDefinition.session_definition_id
                        == SessionOccurrence.session_definition_id,
                    )
                    .join(
                        ScheduleDefinition,
                        ScheduleDefinition.schedule_definition_id
                        == SessionDefinition.schedule_definition_id,
                    )
                    .where(
                        SessionOccurrence.clinic_id == self.context.clinic_id,
                        SessionOccurrence.doctor_id == doctor_id,
                        ScheduleDefinition.weekday == weekday,
                        SessionOccurrence.occurrence_date >= safe_date,
                        SessionOccurrence.status == "AVAILABLE",
                        ~SessionOccurrence.session_occurrence_id.in_(
                            select(Appointment.session_occurrence_id).where(
                                Appointment.clinic_id == self.context.clinic_id,
                                Appointment.doctor_id == doctor_id,
                            )
                        ),
                    )
                )
                unbooked_ids = list(self.db.scalars(unbooked_subquery).all())
                if unbooked_ids:
                    for occ_id in unbooked_ids:
                        occ = self.db.get(SessionOccurrence, occ_id)
                        if occ:
                            self.db.delete(occ)
                    self.db.flush()

            AuditService(self.db).record(
                clinic_id=self.context.clinic_id,
                actor_type="USER",
                actor_user_id=self.context.user_id,
                action_type="SCHEDULE_VERSION_CREATED",
                entity_type="SCHEDULE_DEFINITION",
                entity_id=target_def.schedule_definition_id,
                request_id=_request_id(),
                new_values={
                    "doctor_id": str(doctor_id),
                    "weekday": weekday,
                    "effective_from": safe_date.isoformat(),
                    "session_count": len(request.sessions),
                    "version": target_def.version,
                },
            )

        self.db.flush()
        return self.schedule_overview(doctor_id)

    def replace_weekday(
        self, doctor_id: UUID, weekday: int, request: ScheduleReplaceRequest
    ) -> ScheduleDefinitionResponse:
        if weekday < 0 or weekday > 6:
            raise AppError("INVALID_WEEKDAY", "Weekday must be between 0 and 6.", 422)
        self._doctor(doctor_id)
        same_date = self.db.scalar(
            select(ScheduleDefinition)
            .where(
                ScheduleDefinition.clinic_id == self.context.clinic_id,
                ScheduleDefinition.doctor_id == doctor_id,
                ScheduleDefinition.weekday == weekday,
                ScheduleDefinition.effective_from == request.effective_from,
            )
            .with_for_update()
        )

        if same_date is None:
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
                    ScheduleDefinition.effective_from > request.effective_from,
                )
            )
            if future is not None:
                conflict_date_str = future.effective_from.strftime("%d %b %Y")
                raise AppError(
                    "SCHEDULE_EFFECTIVE_DATE_CONFLICT",
                    f"A newer schedule version is already planned starting {conflict_date_str}.",
                    409,
                    details={"conflicting_effective_from": future.effective_from.isoformat()},
                )

        if same_date is not None:
            same_date.version += 1
            same_date.active = bool(request.sessions)
            existing_sessions = list(
                self.db.scalars(
                    select(SessionDefinition)
                    .where(
                        SessionDefinition.schedule_definition_id == same_date.schedule_definition_id
                    )
                    .order_by(SessionDefinition.display_order, SessionDefinition.start_time)
                ).all()
            )
            min_len = min(len(existing_sessions), len(request.sessions))
            for i in range(min_len):
                sess = existing_sessions[i]
                req_sess = request.sessions[i]
                sess.session_name = req_sess.session_name.strip()
                sess.start_time = req_sess.start_time
                sess.end_time = req_sess.end_time
                sess.slot_interval_minutes = req_sess.slot_interval_minutes
                sess.maximum_capacity = req_sess.maximum_capacity
                sess.active = req_sess.active
                sess.display_order = req_sess.display_order

            if len(request.sessions) > len(existing_sessions):
                for i in range(len(existing_sessions), len(request.sessions)):
                    req_sess = request.sessions[i]
                    self.db.add(
                        SessionDefinition(
                            clinic_id=self.context.clinic_id,
                            schedule_definition_id=same_date.schedule_definition_id,
                            session_name=req_sess.session_name.strip(),
                            start_time=req_sess.start_time,
                            end_time=req_sess.end_time,
                            slot_interval_minutes=req_sess.slot_interval_minutes,
                            maximum_capacity=req_sess.maximum_capacity,
                            active=req_sess.active,
                            display_order=req_sess.display_order,
                        )
                    )
            elif len(existing_sessions) > len(request.sessions):
                for i in range(len(request.sessions), len(existing_sessions)):
                    sess = existing_sessions[i]
                    occ_count = self.db.scalar(
                        select(func.count(SessionOccurrence.session_occurrence_id)).where(
                            SessionOccurrence.session_definition_id == sess.session_definition_id
                        )
                    )
                    if occ_count == 0:
                        self.db.delete(sess)
                    else:
                        sess.active = False
                        sess.display_order = 1000 + i

            self.db.flush()
            AuditService(self.db).record(
                clinic_id=self.context.clinic_id,
                actor_type="USER",
                actor_user_id=self.context.user_id,
                action_type="SCHEDULE_VERSION_CREATED",
                entity_type="SCHEDULE_DEFINITION",
                entity_id=same_date.schedule_definition_id,
                request_id=_request_id(),
                new_values={
                    "doctor_id": str(doctor_id),
                    "weekday": weekday,
                    "effective_from": request.effective_from.isoformat(),
                    "session_count": len(request.sessions),
                },
            )
            return self._schedule_response(same_date)

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

    def replace_multiple_weekdays(
        self, doctor_id: UUID, request: MultiDayScheduleReplaceRequest
    ) -> list[ScheduleDefinitionResponse]:
        self._doctor(doctor_id)
        results: list[ScheduleDefinitionResponse] = []
        for weekday in sorted(request.weekdays):
            req = ScheduleReplaceRequest(
                effective_from=request.effective_from,
                sessions=request.sessions,
            )
            results.append(self.replace_weekday(doctor_id, weekday, req))
        return results

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

        occ_ids = [occ.session_occurrence_id for occ in occurrences.values()]
        appt_counts: dict[UUID, int] = {}
        booked_times_by_occ: dict[UUID, set[time]] = {}
        if occ_ids:
            count_rows = self.db.execute(
                select(Appointment.session_occurrence_id, func.count(Appointment.appointment_id))
                .where(
                    Appointment.clinic_id == self.context.clinic_id,
                    Appointment.session_occurrence_id.in_(occ_ids),
                    Appointment.status != "CANCELLED",
                )
                .group_by(Appointment.session_occurrence_id)
            ).all()
            appt_counts = {r[0]: int(r[1]) for r in count_rows}

            time_rows = self.db.execute(
                select(Appointment.session_occurrence_id, Appointment.appointment_time)
                .where(
                    Appointment.clinic_id == self.context.clinic_id,
                    Appointment.session_occurrence_id.in_(occ_ids),
                    Appointment.status != "CANCELLED",
                    Appointment.appointment_time.is_not(None),
                )
            ).all()
            for occ_id, appt_time in time_rows:
                booked_times_by_occ.setdefault(occ_id, set()).add(appt_time)

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
            used_capacity = appt_counts.get(occurrence.session_occurrence_id, 0) if occurrence else 0
            booked_slots = booked_times_by_occ.get(occurrence.session_occurrence_id, set()) if occurrence else set()
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
                            available=(status == "AVAILABLE" and value not in booked_slots),
                            normal_booking_allowed=(sendable and value not in booked_slots),
                        )
                        for value in generate_slots(start, end, interval)
                    ],
                )
            )
        return AvailabilityResponse(doctor_id=doctor_id, date=target_date, sessions=result)

    def block(self, request: BlockSessionRequest) -> SessionOccurrenceResponse:
        occurrence = self.materialize_occurrence(request.session_definition_id, request.date)
        acquire_doctor_date_locks(self.db, occurrence.doctor_id, [request.date])
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
        acquire_doctor_date_locks(self.db, occurrence.doctor_id, [occurrence.occurrence_date])
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

    def list_exceptions(
        self, doctor_id: UUID, from_date: date | None = None
    ) -> ScheduleExceptionsListResponse:
        doctor = self._doctor(doctor_id)
        effective_from = from_date or self.clock.now_utc().date()
        blocked_occurrences = list(
            self.db.scalars(
                select(SessionOccurrence)
                .where(
                    SessionOccurrence.clinic_id == self.context.clinic_id,
                    SessionOccurrence.doctor_id == doctor.doctor_id,
                    SessionOccurrence.status == "BLOCKED",
                    SessionOccurrence.occurrence_date >= effective_from,
                )
                .order_by(SessionOccurrence.occurrence_date.asc(), SessionOccurrence.start_time_snapshot.asc())
            ).all()
        )

        occ_ids = [occ.session_occurrence_id for occ in blocked_occurrences]
        appt_counts: dict[UUID, int] = {}
        if occ_ids:
            count_rows = self.db.execute(
                select(Appointment.session_occurrence_id, func.count(Appointment.appointment_id))
                .where(
                    Appointment.clinic_id == self.context.clinic_id,
                    Appointment.session_occurrence_id.in_(occ_ids),
                    Appointment.status != "CANCELLED",
                )
                .group_by(Appointment.session_occurrence_id)
            ).all()
            appt_counts = {r[0]: int(r[1]) for r in count_rows}

        occurrences_by_date: dict[date, list[SessionOccurrence]] = {}
        for occ in blocked_occurrences:
            occurrences_by_date.setdefault(occ.occurrence_date, []).append(occ)

        exception_items: list[ScheduleExceptionResponse] = []
        for occ_date, day_occs in sorted(occurrences_by_date.items(), key=lambda x: x[0]):
            active_schedule = self.db.scalar(
                select(ScheduleDefinition).where(
                    ScheduleDefinition.clinic_id == self.context.clinic_id,
                    ScheduleDefinition.doctor_id == doctor.doctor_id,
                    ScheduleDefinition.weekday == occ_date.weekday(),
                    ScheduleDefinition.active.is_(True),
                    ScheduleDefinition.effective_from <= occ_date,
                    or_(
                        ScheduleDefinition.effective_to.is_(None),
                        ScheduleDefinition.effective_to >= occ_date,
                    ),
                )
            )
            active_session_defs = (
                list(
                    self.db.scalars(
                        select(SessionDefinition)
                        .where(
                            SessionDefinition.schedule_definition_id == active_schedule.schedule_definition_id,
                            SessionDefinition.active.is_(True),
                        )
                    ).all()
                )
                if active_schedule
                else []
            )

            distinct_reasons = [o.block_reason for o in day_occs if o.block_reason]
            unique_reasons = list(dict.fromkeys(distinct_reasons))
            is_full_day = (
                len(active_session_defs) > 0
                and len(day_occs) >= len(active_session_defs)
            )

            if is_full_day:
                combined_reason = " / ".join(unique_reasons) if unique_reasons else ""
                total_retained = sum(appt_counts.get(o.session_occurrence_id, 0) for o in day_occs)
                exception_items.append(
                    ScheduleExceptionResponse(
                        id=f"fullday-{occ_date.isoformat()}",
                        occurrence_ids=[o.session_occurrence_id for o in day_occs],
                        date=occ_date,
                        scope="FULL_DAY",
                        session_name=None,
                        start_time=None,
                        end_time=None,
                        reason=combined_reason,
                        status="BLOCKED",
                        retained_appointments_count=total_retained,
                    )
                )
            else:
                for occ in day_occs:
                    exception_items.append(
                        ScheduleExceptionResponse(
                            id=str(occ.session_occurrence_id),
                            occurrence_ids=[occ.session_occurrence_id],
                            date=occ_date,
                            scope="SESSION",
                            session_name=occ.session_name_snapshot,
                            start_time=occ.start_time_snapshot,
                            end_time=occ.end_time_snapshot,
                            reason=occ.block_reason or "",
                            status="BLOCKED",
                            retained_appointments_count=appt_counts.get(occ.session_occurrence_id, 0),
                        )
                    )

        return ScheduleExceptionsListResponse(
            doctor_id=doctor.doctor_id,
            exceptions=exception_items,
            total_count=len(exception_items),
        )

    def block_exception(
        self, doctor_id: UUID, request: BlockScheduleExceptionRequest
    ) -> ScheduleExceptionResponse:
        doctor = self._doctor(doctor_id)
        acquire_doctor_date_locks(self.db, doctor.doctor_id, [request.date])

        definition = self.db.scalar(
            select(ScheduleDefinition).where(
                ScheduleDefinition.clinic_id == self.context.clinic_id,
                ScheduleDefinition.doctor_id == doctor.doctor_id,
                ScheduleDefinition.weekday == request.date.weekday(),
                ScheduleDefinition.active.is_(True),
                ScheduleDefinition.effective_from <= request.date,
                or_(
                    ScheduleDefinition.effective_to.is_(None),
                    ScheduleDefinition.effective_to >= request.date,
                ),
            )
        )
        if definition is None:
            raise AppError(
                "NO_ACTIVE_SCHEDULE",
                "No active schedule found for this doctor on the selected date.",
                422,
            )

        active_sessions = list(
            self.db.scalars(
                select(SessionDefinition)
                .where(
                    SessionDefinition.schedule_definition_id == definition.schedule_definition_id,
                    SessionDefinition.active.is_(True),
                )
                .order_by(SessionDefinition.display_order, SessionDefinition.start_time)
            ).all()
        )
        if not active_sessions:
            raise AppError(
                "NO_ACTIVE_SESSIONS",
                "No active sessions configured for this doctor on the selected date.",
                422,
            )

        if request.scope == "SESSION":
            if not request.session_definition_id:
                raise AppError(
                    "SESSION_DEFINITION_REQUIRED",
                    "A session must be selected when scope is SESSION.",
                    422,
                )
            target_session = next(
                (s for s in active_sessions if s.session_definition_id == request.session_definition_id),
                None,
            )
            if target_session is None:
                raise AppError(
                    "SESSION_NOT_FOUND",
                    "Selected session does not belong to the active schedule on this date.",
                    404,
                )
            block_req = BlockSessionRequest(
                session_definition_id=target_session.session_definition_id,
                date=request.date,
                reason=request.reason,
            )
            occ_res = self.block(block_req)
            retained_count = int(
                self.db.scalar(
                    select(func.count(Appointment.appointment_id)).where(
                        Appointment.clinic_id == self.context.clinic_id,
                        Appointment.session_occurrence_id == occ_res.session_occurrence_id,
                        Appointment.status != "CANCELLED",
                    )
                )
                or 0
            )
            return ScheduleExceptionResponse(
                id=str(occ_res.session_occurrence_id),
                occurrence_ids=[occ_res.session_occurrence_id],
                date=request.date,
                scope="SESSION",
                session_name=occ_res.name,
                start_time=occ_res.start_time,
                end_time=occ_res.end_time,
                reason=request.reason.strip(),
                status="BLOCKED",
                retained_appointments_count=retained_count,
            )
        else:
            target_occurrences: list[SessionOccurrence] = []
            for s in active_sessions:
                occ = self.materialize_occurrence(s.session_definition_id, request.date)
                locked_occ = self.db.scalar(
                    select(SessionOccurrence)
                    .where(SessionOccurrence.session_occurrence_id == occ.session_occurrence_id)
                    .with_for_update()
                )
                if locked_occ is None:  # pragma: no cover
                    raise RuntimeError("Occurrence disappeared while blocking")
                target_occurrences.append(locked_occ)

            unblocked_occurrences = [o for o in target_occurrences if o.status != "BLOCKED"]
            if not unblocked_occurrences:
                raise AppError(
                    "DATE_ALREADY_BLOCKED",
                    "All sessions on this date are already blocked.",
                    409,
                )

            now = self.clock.now_utc()
            for locked_occ in unblocked_occurrences:
                locked_occ.status = "BLOCKED"
                locked_occ.block_reason = request.reason.strip()
                locked_occ.blocked_by = self.context.user_id
                locked_occ.blocked_at = now
                locked_occ.version += 1
                self.db.flush()
                AuditService(self.db).record(
                    clinic_id=self.context.clinic_id,
                    actor_type="USER",
                    actor_user_id=self.context.user_id,
                    action_type="SESSION_BLOCKED",
                    entity_type="SESSION_OCCURRENCE",
                    entity_id=locked_occ.session_occurrence_id,
                    request_id=_request_id(),
                    reason=locked_occ.block_reason,
                    new_values={"status": "BLOCKED", "date": locked_occ.occurrence_date.isoformat()},
                )

            occ_ids = [o.session_occurrence_id for o in target_occurrences]
            total_retained = 0
            if occ_ids:
                total_retained = int(
                    self.db.scalar(
                        select(func.count(Appointment.appointment_id)).where(
                            Appointment.clinic_id == self.context.clinic_id,
                            Appointment.session_occurrence_id.in_(occ_ids),
                            Appointment.status != "CANCELLED",
                        )
                    )
                    or 0
                )

            return ScheduleExceptionResponse(
                id=f"fullday-{request.date.isoformat()}",
                occurrence_ids=occ_ids,
                date=request.date,
                scope="FULL_DAY",
                session_name=None,
                start_time=None,
                end_time=None,
                reason=request.reason.strip(),
                status="BLOCKED",
                retained_appointments_count=total_retained,
            )

    def unblock_exceptions(
        self, doctor_id: UUID, request: UnblockScheduleExceptionRequest
    ) -> UnblockScheduleExceptionResponse:
        doctor = self._doctor(doctor_id)
        if not request.occurrence_ids:
            return UnblockScheduleExceptionResponse(unblocked_count=0)

        unblocked_count = 0
        for occ_id in request.occurrence_ids:
            occ = self.db.scalar(
                select(SessionOccurrence)
                .where(
                    SessionOccurrence.session_occurrence_id == occ_id,
                    SessionOccurrence.clinic_id == self.context.clinic_id,
                    SessionOccurrence.doctor_id == doctor.doctor_id,
                )
                .with_for_update()
            )
            if occ is None:
                continue
            acquire_doctor_date_locks(self.db, occ.doctor_id, [occ.occurrence_date])
            if occ.status == "BLOCKED":
                occ.status = "AVAILABLE"
                occ.block_reason = None
                occ.blocked_by = None
                occ.blocked_at = None
                occ.version += 1
                self.db.flush()
                AuditService(self.db).record(
                    clinic_id=self.context.clinic_id,
                    actor_type="USER",
                    actor_user_id=self.context.user_id,
                    action_type="SESSION_UNBLOCKED",
                    entity_type="SESSION_OCCURRENCE",
                    entity_id=occ.session_occurrence_id,
                    request_id=_request_id(),
                    new_values={"status": "AVAILABLE", "date": occ.occurrence_date.isoformat()},
                )
                unblocked_count += 1

        return UnblockScheduleExceptionResponse(unblocked_count=unblocked_count)

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
            .where(
                SessionDefinition.schedule_definition_id == definition.schedule_definition_id,
                SessionDefinition.active.is_(True),
            )
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
