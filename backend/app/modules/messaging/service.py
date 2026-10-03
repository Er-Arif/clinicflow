from __future__ import annotations

import re
from datetime import datetime, timedelta
from urllib.parse import quote
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.context import request_id_var
from app.core.errors import AppError
from app.modules.appointments.models import Appointment
from app.modules.audit.service import AuditService
from app.modules.clinic.models import Clinic, Doctor
from app.modules.followups.models import FollowUpRecommendation
from app.modules.identity.service import AuthContext
from app.modules.messaging.models import MessageTemplate, Reminder
from app.modules.messaging.schemas import (
    AppointmentMessageRequest,
    MessageTemplateResponse,
    MessageTemplateUpdateRequest,
    PreparedMessageResponse,
    ReminderListResponse,
    ReminderResponse,
    SkipReminderRequest,
)
from app.modules.patients.models import Patient
from app.modules.scheduling.models import SessionOccurrence
from app.modules.visits.models import Visit

ALLOWED_TEMPLATE_VARIABLES = {
    "patient_name",
    "doctor_name",
    "clinic_name",
    "appointment_date",
    "appointment_time",
    "followup_due_date",
}
VARIABLE_RE = re.compile(r"\{([a-z_]+)\}")


def _request_id() -> UUID:
    value = request_id_var.get()
    if value is None:  # pragma: no cover
        raise RuntimeError("request id missing")
    return UUID(value)


def extract_template_variables(body: str) -> set[str]:
    return set(VARIABLE_RE.findall(body))


def validate_template_body(body: str) -> None:
    unsupported = extract_template_variables(body) - ALLOWED_TEMPLATE_VARIABLES
    if unsupported:
        raise AppError(
            "UNSUPPORTED_TEMPLATE_VARIABLE",
            f"Unsupported message variable(s): {', '.join(sorted(unsupported))}.",
            422,
        )


def build_whatsapp_url(phone_e164: str, message: str) -> str:
    digits = "".join(ch for ch in phone_e164 if ch.isdigit())
    return f"https://wa.me/{digits}?text={quote(message, safe='')}"


class ReminderService:
    def __init__(self, db: Session, clock: Clock, context: AuthContext):
        self.db = db
        self.clock = clock
        self.context = context

    def ensure_appointment_reminder(
        self, appointment: Appointment, occurrence: SessionOccurrence
    ) -> Reminder | None:
        patient = self.db.get(Patient, appointment.patient_id)
        if patient is None or not patient.reminders_enabled or appointment.appointment_time is None:
            return None
        if appointment.status != "BOOKED":
            return None
        clinic_now = self.clock.clinic_now()
        scheduled = datetime.combine(
            occurrence.occurrence_date, appointment.appointment_time, tzinfo=clinic_now.tzinfo
        )
        if scheduled - clinic_now <= timedelta(hours=24):
            return None
        existing = self.db.scalar(
            select(Reminder).where(
                Reminder.appointment_id == appointment.appointment_id,
                Reminder.reminder_type == "APPOINTMENT_REMINDER",
            )
        )
        if existing:
            return existing
        due_at = scheduled - timedelta(hours=24)
        reminder = Reminder(
            clinic_id=self.context.clinic_id,
            patient_id=appointment.patient_id,
            appointment_id=appointment.appointment_id,
            reminder_type="APPOINTMENT_REMINDER",
            channel="WHATSAPP_APP",
            language=patient.preferred_language,
            due_on=due_at.date(),
            due_at=due_at,
            status="DUE",
        )
        self.db.add(reminder)
        self.db.flush()
        return reminder

    def ensure_followup_reminder(self, followup: FollowUpRecommendation) -> Reminder | None:
        patient = self.db.get(Patient, followup.patient_id)
        if patient is None or not patient.reminders_enabled:
            return None
        existing = self.db.scalar(
            select(Reminder).where(
                Reminder.followup_id == followup.followup_id,
                Reminder.reminder_type == "FOLLOWUP_REMINDER",
            )
        )
        if existing:
            return existing
        reminder = Reminder(
            clinic_id=self.context.clinic_id,
            patient_id=followup.patient_id,
            followup_id=followup.followup_id,
            reminder_type="FOLLOWUP_REMINDER",
            channel="WHATSAPP_APP",
            language=patient.preferred_language,
            due_on=followup.due_date,
            due_at=None,
            status="DUE",
        )
        self.db.add(reminder)
        self.db.flush()
        return reminder

    def skip_appointment_reminder(self, appointment_id: UUID, reason: str) -> None:
        reminders = self.db.scalars(
            select(Reminder)
            .where(
                Reminder.clinic_id == self.context.clinic_id,
                Reminder.appointment_id == appointment_id,
                Reminder.reminder_type.in_(["APPOINTMENT_REMINDER", "APPOINTMENT_CONFIRMATION"]),
                Reminder.status == "DUE",
            )
            .with_for_update()
        ).all()
        for reminder in reminders:
            self._skip_record(reminder, reason)

    def skip_followup_reminder(self, followup_id: UUID, reason: str) -> None:
        reminder = self.db.scalar(
            select(Reminder)
            .where(
                Reminder.clinic_id == self.context.clinic_id,
                Reminder.followup_id == followup_id,
                Reminder.reminder_type == "FOLLOWUP_REMINDER",
                Reminder.status == "DUE",
            )
            .with_for_update()
        )
        if reminder:
            self._skip_record(reminder, reason)

    def list(
        self,
        *,
        due_on=None,
        due_through=None,
        status: str | None = None,
        reminder_type: str | None = None,
        followup_id: UUID | None = None,
        appointment_id: UUID | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ReminderListResponse:
        conditions = [Reminder.clinic_id == self.context.clinic_id]
        if due_on:
            conditions.append(Reminder.due_on == due_on)
        if due_through:
            conditions.append(Reminder.due_on <= due_through)
        if status:
            status = status.upper()
            if status not in {"DUE", "SENT", "SKIPPED"}:
                raise AppError("INVALID_REMINDER_STATUS", "Invalid reminder status.", 422)
            conditions.append(Reminder.status == status)
        if reminder_type:
            conditions.append(Reminder.reminder_type == reminder_type.upper())
        if followup_id:
            conditions.append(Reminder.followup_id == followup_id)
        if appointment_id:
            conditions.append(Reminder.appointment_id == appointment_id)
        rows = self.db.scalars(
            select(Reminder)
            .where(*conditions)
            .order_by(Reminder.due_on.asc(), Reminder.due_at.asc().nulls_last(), Reminder.created_at.asc())
            .limit(limit)
            .offset(offset)
        ).all()
        total = int(self.db.scalar(select(func.count(Reminder.reminder_id)).where(*conditions)) or 0)
        return ReminderListResponse(
            items=[self._response(row) for row in rows], total=total, limit=limit, offset=offset
        )

    def prepare(self, reminder_id: UUID, language: str | None = None) -> PreparedMessageResponse:
        reminder = self._locked_reminder(reminder_id)
        if reminder.status != "DUE":
            raise AppError("REMINDER_INVALID_STATE", "Only a due reminder can be prepared.", 409)
        sendable, reason = self._sendability(reminder)
        if not sendable:
            raise AppError("REMINDER_SUPPRESSED", "This reminder cannot be sent right now.", 409, {"reason": reason})
        patient = self.db.get(Patient, reminder.patient_id)
        if patient is None:
            raise RuntimeError("Reminder patient integrity failure")
        if not patient.reminders_enabled:
            raise AppError("MESSAGING_DISABLED", "Messaging is disabled for this patient.", 409)
        reminder.language = language or patient.preferred_language
        template = self.db.scalar(
            select(MessageTemplate).where(
                MessageTemplate.clinic_id == self.context.clinic_id,
                MessageTemplate.template_type == reminder.reminder_type,
                MessageTemplate.language == reminder.language,
                MessageTemplate.active.is_(True),
            )
        )
        if template is None:
            raise AppError("MESSAGE_TEMPLATE_NOT_FOUND", "Message template is not configured.", 409)
        validate_template_body(template.template_body)
        values = self._template_values(reminder, patient)
        message = template.template_body.format(**values)
        reminder.message_snapshot = message
        self.db.flush()
        return PreparedMessageResponse(
            reminder=self._response(reminder),
            rendered_message=message,
            whatsapp_url=build_whatsapp_url(patient.whatsapp_e164 or patient.mobile_e164, message),
        )

    def mark_sent(self, reminder_id: UUID) -> ReminderResponse:
        reminder = self._locked_reminder(reminder_id)
        if reminder.status != "DUE":
            raise AppError("REMINDER_INVALID_STATE", "Only a due reminder can be marked sent.", 409)
        sendable, reason = self._sendability(reminder)
        if not sendable:
            raise AppError("REMINDER_SUPPRESSED", "This reminder cannot be sent right now.", 409, {"reason": reason})
        if not reminder.message_snapshot:
            raise AppError("REMINDER_NOT_PREPARED", "Prepare the message before marking it sent.", 409)
        reminder.status = "SENT"
        reminder.sent_by = self.context.user_id
        reminder.sent_at = self.clock.now_utc()
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="REMINDER_MARKED_SENT",
            entity_type="REMINDER",
            entity_id=reminder.reminder_id,
            request_id=_request_id(),
            new_values={"status": "SENT", "reminder_type": reminder.reminder_type},
        )
        return self._response(reminder)

    def skip(self, reminder_id: UUID, request: SkipReminderRequest) -> ReminderResponse:
        reminder = self._locked_reminder(reminder_id)
        if reminder.status != "DUE":
            raise AppError("REMINDER_INVALID_STATE", "Only a due reminder can be skipped.", 409)
        self._skip_record(reminder, request.reason.strip())
        return self._response(reminder)

    def create_appointment_message(
        self, appointment_id: UUID, request: AppointmentMessageRequest
    ) -> PreparedMessageResponse:
        appointment = self.db.scalar(
            select(Appointment)
            .where(
                Appointment.appointment_id == appointment_id,
                Appointment.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if appointment is None:
            raise AppError("APPOINTMENT_NOT_FOUND", "Appointment not found.", 404)
        self._validate_appointment_message_type(appointment, request.message_type)
        patient = self.db.get(Patient, appointment.patient_id)
        if patient is None:
            raise RuntimeError("Appointment patient integrity failure")
        if not patient.reminders_enabled:
            raise AppError("MESSAGING_DISABLED", "Messaging is disabled for this patient.", 409)
        reminder = self.db.scalar(
            select(Reminder).where(
                Reminder.appointment_id == appointment.appointment_id,
                Reminder.reminder_type == request.message_type,
            )
        )
        if reminder is None:
            reminder = Reminder(
                clinic_id=self.context.clinic_id,
                patient_id=appointment.patient_id,
                appointment_id=appointment.appointment_id,
                reminder_type=request.message_type,
                channel="WHATSAPP_APP",
                language=request.language or patient.preferred_language,
                due_on=self.clock.clinic_date(),
                status="DUE",
            )
            self.db.add(reminder)
            self.db.flush()
        elif reminder.status != "DUE":
            raise AppError("REMINDER_INVALID_STATE", "This message has already been handled.", 409)
        return self.prepare(reminder.reminder_id, request.language)

    def templates(self) -> list[MessageTemplateResponse]:
        rows = self.db.scalars(
            select(MessageTemplate)
            .where(MessageTemplate.clinic_id == self.context.clinic_id)
            .order_by(MessageTemplate.template_type, MessageTemplate.language)
        ).all()
        return [self._template_response(row) for row in rows]

    def update_template(
        self, template_id: UUID, request: MessageTemplateUpdateRequest
    ) -> MessageTemplateResponse:
        validate_template_body(request.template_body)
        template = self.db.scalar(
            select(MessageTemplate)
            .where(
                MessageTemplate.template_id == template_id,
                MessageTemplate.clinic_id == self.context.clinic_id,
            )
            .with_for_update()
        )
        if template is None:
            raise AppError("MESSAGE_TEMPLATE_NOT_FOUND", "Message template not found.", 404)
        if template.version != request.expected_version:
            raise AppError("STALE_VERSION", "This message template was changed by another user.", 409)
        previous = template.template_body
        template.template_body = request.template_body
        template.active = request.active
        template.version += 1
        template.updated_by = self.context.user_id
        template.updated_at = self.clock.now_utc()
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="MESSAGE_TEMPLATE_UPDATED",
            entity_type="MESSAGE_TEMPLATE",
            entity_id=template.template_id,
            request_id=_request_id(),
            previous_values={"template_body": previous},
            new_values={"template_body": template.template_body, "active": template.active},
        )
        return self._template_response(template)

    def _template_values(self, reminder: Reminder, patient: Patient) -> dict[str, str]:
        clinic = self.db.get(Clinic, self.context.clinic_id)
        if clinic is None:
            raise RuntimeError("Clinic integrity failure")
        values = {
            "patient_name": patient.full_name,
            "doctor_name": "",
            "clinic_name": clinic.clinic_name,
            "appointment_date": "",
            "appointment_time": "",
            "followup_due_date": "",
        }
        if reminder.appointment_id:
            appointment = self.db.get(Appointment, reminder.appointment_id)
            if appointment is None:
                raise RuntimeError("Reminder appointment integrity failure")
            doctor = self.db.get(Doctor, appointment.doctor_id)
            occurrence = self.db.get(SessionOccurrence, appointment.session_occurrence_id)
            if doctor is None or occurrence is None:
                raise RuntimeError("Reminder appointment reference integrity failure")
            values.update(
                doctor_name=doctor.display_name,
                appointment_date=occurrence.occurrence_date.strftime("%d %b %Y"),
                appointment_time=(appointment.appointment_time.strftime("%I:%M %p") if appointment.appointment_time else "Walk-in"),
            )
        if reminder.followup_id:
            followup = self.db.get(FollowUpRecommendation, reminder.followup_id)
            if followup is None:
                raise RuntimeError("Reminder follow-up integrity failure")
            visit = self.db.get(Visit, followup.source_visit_id)
            if visit is None:
                raise RuntimeError("Follow-up visit integrity failure")
            doctor = self.db.get(Doctor, visit.doctor_id)
            if doctor is None:
                raise RuntimeError("Follow-up doctor integrity failure")
            values.update(
                doctor_name=doctor.display_name,
                followup_due_date=followup.due_date.strftime("%d %b %Y"),
            )
        return values

    def _sendability(self, reminder: Reminder) -> tuple[bool, str | None]:
        if reminder.reminder_type == "APPOINTMENT_REMINDER" and reminder.appointment_id:
            appointment = self.db.get(Appointment, reminder.appointment_id)
            if appointment is None:
                return False, "APPOINTMENT_NOT_FOUND"
            occurrence = self.db.get(SessionOccurrence, appointment.session_occurrence_id)
            if occurrence and occurrence.status == "BLOCKED" and appointment.status in {"BOOKED", "CHECKED_IN"}:
                return False, "SESSION_BLOCKED"
            if appointment.status != "BOOKED":
                return False, "APPOINTMENT_NOT_BOOKED"
        if reminder.followup_id:
            followup = self.db.get(FollowUpRecommendation, reminder.followup_id)
            if followup is None or followup.status != "OPEN":
                return False, "FOLLOWUP_NOT_OPEN"
        return True, None

    def _validate_appointment_message_type(self, appointment: Appointment, message_type: str) -> None:
        if message_type == "APPOINTMENT_CONFIRMATION" and appointment.status != "BOOKED":
            raise AppError("MESSAGE_TYPE_INVALID_FOR_STATE", "Confirmation is only available for a booked appointment.", 409)
        if message_type == "APPOINTMENT_CANCELLED" and appointment.status != "CANCELLED":
            raise AppError("MESSAGE_TYPE_INVALID_FOR_STATE", "Cancellation message requires a cancelled appointment.", 409)
        if message_type == "APPOINTMENT_RESCHEDULED" and (
            appointment.status != "BOOKED" or appointment.rescheduled_from_appointment_id is None
        ):
            raise AppError("MESSAGE_TYPE_INVALID_FOR_STATE", "Reschedule message requires the replacement appointment.", 409)

    def _locked_reminder(self, reminder_id: UUID) -> Reminder:
        reminder = self.db.scalar(
            select(Reminder)
            .where(Reminder.reminder_id == reminder_id, Reminder.clinic_id == self.context.clinic_id)
            .with_for_update()
        )
        if reminder is None:
            raise AppError("REMINDER_NOT_FOUND", "Reminder not found.", 404)
        return reminder

    def _skip_record(self, reminder: Reminder, reason: str) -> None:
        reminder.status = "SKIPPED"
        reminder.skipped_by = self.context.user_id
        reminder.skipped_at = self.clock.now_utc()
        reminder.skip_reason = reason[:100]
        self.db.flush()
        AuditService(self.db).record(
            clinic_id=self.context.clinic_id,
            actor_type="USER",
            actor_user_id=self.context.user_id,
            action_type="REMINDER_SKIPPED",
            entity_type="REMINDER",
            entity_id=reminder.reminder_id,
            request_id=_request_id(),
            reason=reminder.skip_reason,
            new_values={"status": "SKIPPED", "reminder_type": reminder.reminder_type},
        )

    def _response(self, reminder: Reminder) -> ReminderResponse:
        patient = self.db.get(Patient, reminder.patient_id)
        if patient is None:
            raise RuntimeError("Reminder patient integrity failure")
        sendable, reason = self._sendability(reminder) if reminder.status == "DUE" else (False, None)
        return ReminderResponse(
            reminder_id=reminder.reminder_id,
            patient_id=reminder.patient_id,
            patient_name=patient.full_name,
            whatsapp_number=patient.whatsapp_e164 or patient.mobile_e164,
            appointment_id=reminder.appointment_id,
            followup_id=reminder.followup_id,
            reminder_type=reminder.reminder_type,
            channel=reminder.channel,
            language=reminder.language,
            due_on=reminder.due_on,
            due_at=reminder.due_at,
            status=reminder.status,
            message_snapshot=reminder.message_snapshot,
            sent_at=reminder.sent_at,
            skipped_at=reminder.skipped_at,
            skip_reason=reminder.skip_reason,
            sendable=sendable,
            suppression_reason=reason,
        )

    @staticmethod
    def _template_response(template: MessageTemplate) -> MessageTemplateResponse:
        return MessageTemplateResponse(
            template_id=template.template_id,
            template_type=template.template_type,
            language=template.language,
            template_body=template.template_body,
            active=template.active,
            version=template.version,
            updated_at=template.updated_at,
        )
