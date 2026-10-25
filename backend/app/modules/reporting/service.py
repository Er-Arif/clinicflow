from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import settings
from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.audit.models import AuditEvent
from app.modules.followups.models import FollowUpRecommendation
from app.modules.identity.models import User
from app.modules.identity.service import AuthContext
from app.modules.messaging.models import Reminder
from app.modules.patients.models import Patient
from app.modules.payments.models import Payment
from app.modules.reporting.aggregation import summarize_appointment_status_rows
from app.modules.reporting.schemas import (
    AppointmentReportResponse,
    AssistantHomeResponse,
    AuditEventListResponse,
    AuditEventResponse,
    DoctorTodayResponse,
    FollowUpReportResponse,
    OpenFollowUpSummary,
    OperationalAppointmentItem,
    OwnerDashboardResponse,
    PatientOperationalSummaryResponse,
    PatientReportResponse,
    PatientSummaryBase,
    PaymentReportResponse,
    UpcomingAppointmentSummary,
    VisitHistoryItem,
)
from app.modules.scheduling.models import SessionOccurrence
from app.modules.visits.models import Visit

_ZERO = Decimal("0.00")


def _money(value: Decimal | int | None) -> Decimal:
    if value is None:
        return _ZERO
    return Decimal(value).quantize(Decimal("0.01"))


class ReportingService:
    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def assistant_home(self) -> AssistantHomeResponse:
        today = self.clock.clinic_date()
        counts = self._appointment_status_counts(today, today)
        pending = int(
            self.db.scalar(
                select(func.count(Payment.payment_id))
                .join(Visit, Visit.visit_id == Payment.visit_id)
                .join(Appointment, Appointment.appointment_id == Visit.appointment_id)
                .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
                .where(
                    Payment.clinic_id == self.context.clinic_id,
                    Payment.status == "PENDING",
                    SessionOccurrence.occurrence_date == today,
                )
            )
            or 0
        )
        due_reminders = int(
            self.db.scalar(
                select(func.count(Reminder.reminder_id)).where(
                    Reminder.clinic_id == self.context.clinic_id,
                    Reminder.status == "DUE",
                    Reminder.due_on <= today,
                )
            )
            or 0
        )
        overdue = int(
            self.db.scalar(
                select(func.count(FollowUpRecommendation.followup_id)).where(
                    FollowUpRecommendation.clinic_id == self.context.clinic_id,
                    FollowUpRecommendation.status == "OPEN",
                    FollowUpRecommendation.due_date < today,
                )
            )
            or 0
        )
        next_items = self._operational_appointments(today, status="BOOKED", limit=5, future_only=True)
        checked_in = self._operational_appointments(today, status="CHECKED_IN", limit=8)
        total = sum(counts.values())
        return AssistantHomeResponse(
            clinic_date=today,
            appointments=total,
            booked=counts.get("BOOKED", 0),
            checked_in=counts.get("CHECKED_IN", 0),
            completed=counts.get("COMPLETED", 0),
            cancelled=counts.get("CANCELLED", 0),
            pending_payments=pending,
            due_reminders=due_reminders,
            overdue_followups=overdue,
            next_appointments=next_items,
            checked_in_patients=checked_in,
        )

    def doctor_today(self, target_date: date | None = None) -> DoctorTodayResponse:
        target = target_date or self.clock.clinic_date()
        counts = self._appointment_status_counts(target, target)
        checked_in = self._operational_appointments(target, status="CHECKED_IN", limit=100)
        upcoming = self._operational_appointments(
            target,
            status="BOOKED",
            limit=100,
            future_only=(target == self.clock.clinic_date()),
            timed_only=True,
        )
        # Summary counts must not inherit the display lists' 100-row limit.
        upcoming_conditions = [
            Appointment.clinic_id == self.context.clinic_id,
            SessionOccurrence.occurrence_date == target,
            Appointment.status == "BOOKED",
            Appointment.appointment_time.is_not(None),
        ]
        if target == self.clock.clinic_date():
            upcoming_conditions.append(
                Appointment.appointment_time >= self.clock.clinic_now().time().replace(tzinfo=None)
            )
        upcoming_count = self.db.scalar(
            select(func.count(Appointment.appointment_id))
            .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
            .where(*upcoming_conditions)
        ) or 0
        return DoctorTodayResponse(
            date=target,
            total_appointments=sum(counts.values()),
            checked_in_count=counts.get("CHECKED_IN", 0),
            upcoming_count=upcoming_count,
            checked_in=checked_in,
            upcoming=upcoming,
        )

    def patient_summary(self, patient_id: UUID, *, history_limit: int = 30) -> PatientOperationalSummaryResponse:
        patient = self.db.scalar(
            select(Patient).where(
                Patient.clinic_id == self.context.clinic_id,
                Patient.patient_id == patient_id,
            )
        )
        if patient is None:
            raise AppError("PATIENT_NOT_FOUND", "Patient not found.", 404)

        history_rows = self.db.execute(
            select(
                Visit.visit_id,
                Appointment.appointment_id,
                SessionOccurrence.occurrence_date,
                Appointment.appointment_type,
                Visit.completed_at,
                Payment.status.label("payment_status"),
                FollowUpRecommendation.status.label("followup_status"),
            )
            .join(Appointment, Appointment.appointment_id == Visit.appointment_id)
            .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
            .outerjoin(
                Payment,
                and_(Payment.visit_id == Visit.visit_id, Payment.status.in_(["PENDING", "CONFIRMED"])),
            )
            .outerjoin(FollowUpRecommendation, FollowUpRecommendation.source_visit_id == Visit.visit_id)
            .where(
                Visit.clinic_id == self.context.clinic_id,
                Visit.patient_id == patient_id,
                Visit.status == "COMPLETED",
            )
            .order_by(SessionOccurrence.occurrence_date.desc(), Visit.completed_at.desc())
            .limit(history_limit)
        ).all()

        total_completed = int(
            self.db.scalar(
                select(func.count(Visit.visit_id)).where(
                    Visit.clinic_id == self.context.clinic_id,
                    Visit.patient_id == patient_id,
                    Visit.status == "COMPLETED",
                )
            )
            or 0
        )
        last_visit_date = history_rows[0].occurrence_date if history_rows else None

        today = self.clock.clinic_date()
        upcoming_row = self.db.execute(
            select(
                Appointment.appointment_id,
                SessionOccurrence.occurrence_date,
                Appointment.appointment_time,
                Appointment.appointment_type,
                Appointment.status,
            )
            .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
            .where(
                Appointment.clinic_id == self.context.clinic_id,
                Appointment.patient_id == patient_id,
                Appointment.status == "BOOKED",
                SessionOccurrence.occurrence_date >= today,
            )
            .order_by(SessionOccurrence.occurrence_date, Appointment.appointment_time.asc().nulls_last())
            .limit(1)
        ).first()
        followup = self.db.scalar(
            select(FollowUpRecommendation)
            .where(
                FollowUpRecommendation.clinic_id == self.context.clinic_id,
                FollowUpRecommendation.patient_id == patient_id,
                FollowUpRecommendation.status == "OPEN",
            )
            .order_by(FollowUpRecommendation.due_date)
            .limit(1)
        )
        return PatientOperationalSummaryResponse(
            patient=PatientSummaryBase(
                patient_id=patient.patient_id,
                patient_code=patient.patient_code,
                full_name=patient.full_name,
                mobile_number=patient.mobile_e164,
                gender=patient.gender,
                age=self._patient_age(patient),
            ),
            total_completed_visits=total_completed,
            last_visit_date=last_visit_date,
            upcoming_appointment=(
                UpcomingAppointmentSummary(
                    appointment_id=upcoming_row.appointment_id,
                    date=upcoming_row.occurrence_date,
                    appointment_time=upcoming_row.appointment_time,
                    appointment_type=upcoming_row.appointment_type,
                    status=upcoming_row.status,
                )
                if upcoming_row
                else None
            ),
            open_followup=(
                OpenFollowUpSummary(
                    followup_id=followup.followup_id,
                    due_date=followup.due_date,
                    overdue=followup.due_date < today,
                    status=followup.status,
                )
                if followup
                else None
            ),
            visit_history=[
                VisitHistoryItem(
                    visit_id=row.visit_id,
                    appointment_id=row.appointment_id,
                    date=row.occurrence_date,
                    appointment_type=row.appointment_type,
                    completed_at=row.completed_at,
                    payment_status=row.payment_status,
                    followup_status=row.followup_status,
                )
                for row in history_rows
            ],
        )

    def owner_dashboard(self, date_from: date, date_to: date) -> OwnerDashboardResponse:
        date_from, date_to = self._validate_range(date_from, date_to)
        appointment_report = self.appointment_report(date_from, date_to)
        patient_report = self.patient_report(date_from, date_to)
        payment_report = self.payment_report(date_from, date_to)
        followup_appointments = int(
            self.db.scalar(
                select(func.count(Appointment.appointment_id))
                .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
                .where(
                    Appointment.clinic_id == self.context.clinic_id,
                    Appointment.appointment_type == "FOLLOW_UP",
                    SessionOccurrence.occurrence_date.between(date_from, date_to),
                )
            )
            or 0
        )
        return OwnerDashboardResponse(
            date_from=date_from,
            date_to=date_to,
            appointments=appointment_report.total_appointments,
            checked_in=appointment_report.checked_in,
            completed=appointment_report.completed,
            cancelled=appointment_report.cancelled,
            no_show=appointment_report.no_show,
            new_patients=patient_report.new_patients,
            returning_patient_visits=patient_report.returning_patient_visits,
            unique_patients=patient_report.unique_patients,
            followup_appointments=followup_appointments,
            confirmed_revenue=payment_report.confirmed_total,
            cash=payment_report.cash,
            upi=payment_report.upi,
            pending_amount=payment_report.pending,
        )

    def appointment_report(self, date_from: date, date_to: date) -> AppointmentReportResponse:
        date_from, date_to = self._validate_range(date_from, date_to)
        rows = self.db.execute(
            select(Appointment.status, Appointment.cancellation_reason, func.count(Appointment.appointment_id))
            .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
            .where(
                Appointment.clinic_id == self.context.clinic_id,
                SessionOccurrence.occurrence_date.between(date_from, date_to),
            )
            .group_by(Appointment.status, Appointment.cancellation_reason)
        ).all()
        summary = summarize_appointment_status_rows(rows)
        return AppointmentReportResponse(
            date_from=date_from,
            date_to=date_to,
            total_appointments=summary.total,
            booked=summary.booked,
            checked_in=summary.checked_in,
            completed=summary.completed,
            cancelled=summary.cancelled,
            no_show=summary.no_show,
            rescheduled=summary.rescheduled,
        )

    def patient_report(self, date_from: date, date_to: date) -> PatientReportResponse:
        date_from, date_to = self._validate_range(date_from, date_to)
        numbered = (
            select(
                Visit.patient_id.label("patient_id"),
                SessionOccurrence.occurrence_date.label("visit_date"),
                func.row_number()
                .over(
                    partition_by=Visit.patient_id,
                    order_by=(SessionOccurrence.occurrence_date, Visit.completed_at, Visit.visit_id),
                )
                .label("visit_number"),
            )
            .join(Appointment, Appointment.appointment_id == Visit.appointment_id)
            .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
            .where(
                Visit.clinic_id == self.context.clinic_id,
                Visit.status == "COMPLETED",
                SessionOccurrence.occurrence_date <= date_to,
            )
            .subquery()
        )
        row = self.db.execute(
            select(
                func.count().filter(numbered.c.visit_number == 1).label("new_patients"),
                func.count().filter(numbered.c.visit_number > 1).label("returning_visits"),
                func.count(func.distinct(numbered.c.patient_id)).label("unique_patients"),
            ).where(numbered.c.visit_date.between(date_from, date_to))
        ).one()
        return PatientReportResponse(
            date_from=date_from,
            date_to=date_to,
            new_patients=int(row.new_patients or 0),
            returning_patient_visits=int(row.returning_visits or 0),
            unique_patients=int(row.unique_patients or 0),
        )

    def followup_report(self, date_from: date, date_to: date) -> FollowUpReportResponse:
        date_from, date_to = self._validate_range(date_from, date_to)
        start_utc, end_utc = self._utc_bounds(date_from, date_to)
        created = int(
            self.db.scalar(
                select(func.count(FollowUpRecommendation.followup_id)).where(
                    FollowUpRecommendation.clinic_id == self.context.clinic_id,
                    FollowUpRecommendation.created_at >= start_utc,
                    FollowUpRecommendation.created_at < end_utc,
                )
            )
            or 0
        )
        audit_rows = dict(
            self.db.execute(
                select(AuditEvent.action_type, func.count(AuditEvent.audit_id))
                .where(
                    AuditEvent.clinic_id == self.context.clinic_id,
                    AuditEvent.occurred_at >= start_utc,
                    AuditEvent.occurred_at < end_utc,
                    AuditEvent.action_type.in_(["FOLLOWUP_BOOKED", "FOLLOWUP_CLOSED"]),
                )
                .group_by(AuditEvent.action_type)
            ).all()
        )
        current_today = self.clock.clinic_date()
        open_current = int(
            self.db.scalar(
                select(func.count(FollowUpRecommendation.followup_id)).where(
                    FollowUpRecommendation.clinic_id == self.context.clinic_id,
                    FollowUpRecommendation.status == "OPEN",
                )
            )
            or 0
        )
        overdue_current = int(
            self.db.scalar(
                select(func.count(FollowUpRecommendation.followup_id)).where(
                    FollowUpRecommendation.clinic_id == self.context.clinic_id,
                    FollowUpRecommendation.status == "OPEN",
                    FollowUpRecommendation.due_date < current_today,
                )
            )
            or 0
        )
        return FollowUpReportResponse(
            date_from=date_from,
            date_to=date_to,
            created=created,
            booked_events=int(audit_rows.get("FOLLOWUP_BOOKED", 0)),
            closed_events=int(audit_rows.get("FOLLOWUP_CLOSED", 0)),
            open_current=open_current,
            overdue_current=overdue_current,
        )

    def payment_report(self, date_from: date, date_to: date) -> PaymentReportResponse:
        date_from, date_to = self._validate_range(date_from, date_to)
        start_utc, end_utc = self._utc_bounds(date_from, date_to)
        confirmed_row = self.db.execute(
            select(
                func.coalesce(func.sum(Payment.amount_paid), 0).label("confirmed_total"),
                func.coalesce(
                    func.sum(case((Payment.payment_method == "CASH", Payment.amount_paid), else_=0)), 0
                ).label("cash"),
                func.coalesce(
                    func.sum(case((Payment.payment_method == "UPI", Payment.amount_paid), else_=0)), 0
                ).label("upi"),
                func.count(Payment.payment_id).label("confirmed_count"),
            ).where(
                Payment.clinic_id == self.context.clinic_id,
                Payment.status == "CONFIRMED",
                Payment.confirmed_at >= start_utc,
                Payment.confirmed_at < end_utc,
            )
        ).one()
        pending = self.db.scalar(
            select(func.coalesce(func.sum(Payment.amount_due), 0))
            .join(Visit, Visit.visit_id == Payment.visit_id)
            .join(Appointment, Appointment.appointment_id == Visit.appointment_id)
            .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
            .where(
                Payment.clinic_id == self.context.clinic_id,
                Payment.status == "PENDING",
                SessionOccurrence.occurrence_date.between(date_from, date_to),
            )
        )
        voided = int(
            self.db.scalar(
                select(func.count(Payment.payment_id)).where(
                    Payment.clinic_id == self.context.clinic_id,
                    Payment.status == "VOID",
                    Payment.voided_at >= start_utc,
                    Payment.voided_at < end_utc,
                )
            )
            or 0
        )
        return PaymentReportResponse(
            date_from=date_from,
            date_to=date_to,
            confirmed_total=_money(confirmed_row.confirmed_total),
            cash=_money(confirmed_row.cash),
            upi=_money(confirmed_row.upi),
            pending=_money(pending),
            confirmed_transaction_count=int(confirmed_row.confirmed_count or 0),
            voided_payment_count=voided,
        )

    def audit_events(
        self,
        *,
        date_from: date | None,
        date_to: date | None,
        actor_user_id: UUID | None,
        action_type: str | None,
        entity_type: str | None,
        limit: int,
        offset: int,
    ) -> AuditEventListResponse:
        filters = [AuditEvent.clinic_id == self.context.clinic_id]
        if date_from or date_to:
            start = date_from or date(2000, 1, 1)
            end = date_to or self.clock.clinic_date()
            start, end = self._validate_range(start, end)
            start_utc, end_utc = self._utc_bounds(start, end)
            filters.extend([AuditEvent.occurred_at >= start_utc, AuditEvent.occurred_at < end_utc])
        if actor_user_id is not None:
            filters.append(AuditEvent.actor_user_id == actor_user_id)
        if action_type:
            filters.append(AuditEvent.action_type == action_type.strip().upper())
        if entity_type:
            filters.append(AuditEvent.entity_type == entity_type.strip().upper())
        query = (
            select(AuditEvent, User.display_name.label("actor_display_name"))
            .outerjoin(User, User.user_id == AuditEvent.actor_user_id)
            .where(*filters)
        )
        total = int(
            self.db.scalar(select(func.count(AuditEvent.audit_id)).where(*filters)) or 0
        )
        rows = self.db.execute(
            query.order_by(AuditEvent.occurred_at.desc()).limit(limit).offset(offset)
        ).all()
        return AuditEventListResponse(
            items=[
                AuditEventResponse(
                    audit_id=event.audit_id,
                    occurred_at=event.occurred_at,
                    actor_type=event.actor_type,
                    actor_user_id=event.actor_user_id,
                    actor_display_name=actor_name,
                    action_type=event.action_type,
                    entity_type=event.entity_type,
                    entity_id=event.entity_id,
                    reason=event.reason,
                    previous_values=event.previous_values,
                    new_values=event.new_values,
                    metadata=event.metadata_json,
                    request_id=event.request_id,
                )
                for event, actor_name in rows
            ],
            total=total,
            limit=limit,
            offset=offset,
        )

    def audit_event(self, audit_id: UUID) -> AuditEventResponse:
        row = self.db.execute(
            select(AuditEvent, User.display_name.label("actor_display_name"))
            .outerjoin(User, User.user_id == AuditEvent.actor_user_id)
            .where(
                AuditEvent.audit_id == audit_id,
                AuditEvent.clinic_id == self.context.clinic_id,
            )
        ).first()
        if row is None:
            raise AppError("AUDIT_EVENT_NOT_FOUND", "Audit event was not found.", 404)
        event, actor_name = row
        return AuditEventResponse(
            audit_id=event.audit_id,
            occurred_at=event.occurred_at,
            actor_type=event.actor_type,
            actor_user_id=event.actor_user_id,
            actor_display_name=actor_name,
            action_type=event.action_type,
            entity_type=event.entity_type,
            entity_id=event.entity_id,
            reason=event.reason,
            previous_values=event.previous_values,
            new_values=event.new_values,
            metadata=event.metadata_json,
            request_id=event.request_id,
        )

    def _appointment_status_counts(self, date_from: date, date_to: date) -> dict[str, int]:
        return {
            status: int(count)
            for status, count in self.db.execute(
                select(Appointment.status, func.count(Appointment.appointment_id))
                .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
                .where(
                    Appointment.clinic_id == self.context.clinic_id,
                    SessionOccurrence.occurrence_date.between(date_from, date_to),
                )
                .group_by(Appointment.status)
            ).all()
        }

    def _operational_appointments(
        self,
        target_date: date,
        *,
        status: str,
        limit: int,
        future_only: bool = False,
        timed_only: bool = False,
    ) -> list[OperationalAppointmentItem]:
        query = (
            select(
                Appointment.appointment_id,
                Appointment.patient_id,
                Patient.patient_code,
                Patient.full_name,
                Appointment.appointment_time,
                Appointment.appointment_type,
                Appointment.status,
                Payment.status.label("payment_status"),
                Visit.checked_in_at,
            )
            .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
            .join(Patient, Patient.patient_id == Appointment.patient_id)
            .outerjoin(Visit, Visit.appointment_id == Appointment.appointment_id)
            .outerjoin(
                Payment,
                and_(Payment.visit_id == Visit.visit_id, Payment.status.in_(["PENDING", "CONFIRMED"])),
            )
            .where(
                Appointment.clinic_id == self.context.clinic_id,
                SessionOccurrence.occurrence_date == target_date,
                Appointment.status == status,
            )
        )
        if timed_only:
            query = query.where(Appointment.appointment_time.is_not(None))
        if future_only and target_date == self.clock.clinic_date():
            current_time = self.clock.clinic_now().time().replace(tzinfo=None)
            query = query.where(
                or_(Appointment.appointment_time.is_(None), Appointment.appointment_time >= current_time)
            )
        rows = self.db.execute(
            query.order_by(Appointment.appointment_time.asc().nulls_last(), Appointment.created_at).limit(limit)
        ).all()
        return [
            OperationalAppointmentItem(
                appointment_id=row.appointment_id,
                patient_id=row.patient_id,
                patient_code=row.patient_code,
                patient_name=row.full_name,
                appointment_time=row.appointment_time,
                appointment_type=row.appointment_type,
                status=row.status,
                payment_status=row.payment_status,
                checked_in_at=row.checked_in_at,
            )
            for row in rows
        ]

    def _utc_bounds(self, date_from: date, date_to: date) -> tuple[datetime, datetime]:
        zone = ZoneInfo(settings.clinic_timezone)
        start_local = datetime.combine(date_from, time.min, tzinfo=zone)
        end_local = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=zone)
        return start_local.astimezone(UTC), end_local.astimezone(UTC)

    @staticmethod
    def _validate_range(date_from: date, date_to: date) -> tuple[date, date]:
        if date_to < date_from:
            raise AppError("INVALID_DATE_RANGE", "End date must be on or after start date.", 422)
        if (date_to - date_from).days > 366:
            raise AppError("DATE_RANGE_TOO_LARGE", "Report range cannot exceed 367 days.", 422)
        return date_from, date_to

    def _patient_age(self, patient: Patient) -> int | None:
        today = self.clock.clinic_date()
        if patient.date_of_birth:
            years = today.year - patient.date_of_birth.year
            if (today.month, today.day) < (patient.date_of_birth.month, patient.date_of_birth.day):
                years -= 1
            return max(years, 0)
        if patient.approximate_age_years is not None and patient.age_as_of_date is not None:
            extra = today.year - patient.age_as_of_date.year
            if (today.month, today.day) < (patient.age_as_of_date.month, patient.age_as_of_date.day):
                extra -= 1
            return max(patient.approximate_age_years + extra, 0)
        return None
