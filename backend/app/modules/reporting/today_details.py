from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.modules.appointments.models import Appointment
from app.modules.identity.service import AuthContext
from app.modules.patients.models import Patient
from app.modules.reporting.schemas import DoctorTodayDetailItem, DoctorTodayDetailsResponse
from app.modules.scheduling.models import SessionOccurrence


def _patient_age(patient: Patient, today: date) -> int | None:
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


def doctor_today_details(
    db: Session,
    clock: Clock,
    context: AuthContext,
    *,
    target_date: date | None,
    view: str,
) -> DoctorTodayDetailsResponse:
    target = target_date or clock.clinic_date()
    conditions = [
        Appointment.clinic_id == context.clinic_id,
        SessionOccurrence.occurrence_date == target,
    ]

    if view == "checked_in":
        conditions.append(Appointment.status == "CHECKED_IN")
    elif view == "upcoming":
        conditions.extend(
            [
                Appointment.status == "BOOKED",
                Appointment.appointment_time.is_not(None),
            ]
        )
        if target == clock.clinic_date():
            current_time = clock.clinic_now().time().replace(tzinfo=None)
            conditions.append(Appointment.appointment_time >= current_time)
    elif view != "all":
        raise ValueError("Unsupported doctor today detail view")

    rows = db.execute(
        select(Appointment, Patient)
        .join(SessionOccurrence, SessionOccurrence.session_occurrence_id == Appointment.session_occurrence_id)
        .join(Patient, Patient.patient_id == Appointment.patient_id)
        .where(*conditions)
        .order_by(
            Appointment.appointment_time.asc().nulls_last(),
            Appointment.created_at,
        )
        .limit(500)
    ).all()

    items = [
        DoctorTodayDetailItem(
            appointment_id=appointment.appointment_id,
            patient_id=patient.patient_id,
            patient_name=patient.full_name,
            mobile_number=patient.mobile_e164,
            gender=patient.gender,
            age=_patient_age(patient, target),
            appointment_time=appointment.appointment_time,
            appointment_type=appointment.appointment_type,
            status=appointment.status,
        )
        for appointment, patient in rows
    ]
    return DoctorTodayDetailsResponse(date=target, view=view, total=len(items), items=items)
