export type AppointmentPatientSummary = {
  patient_id: string;
  patient_code: string;
  full_name: string;
  mobile_number: string;
};

export type AppointmentDoctorSummary = {
  doctor_id: string;
  display_name: string;
};

export type AppointmentSessionSummary = {
  session_occurrence_id: string;
  session_definition_id: string;
  date: string;
  name: string;
  start_time: string;
  end_time: string;
};

export type Appointment = {
  appointment_id: string;
  patient: AppointmentPatientSummary;
  doctor: AppointmentDoctorSummary;
  session: AppointmentSessionSummary;
  appointment_time: string | null;
  appointment_type: 'REGULAR' | 'FOLLOW_UP';
  booking_source: 'ASSISTANT' | 'ADMIN' | 'WALK_IN';
  status: 'BOOKED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
  base_fee: string | number;
  effective_fee: string | number;
  fee_adjusted: boolean;
  capacity_override_used: boolean;
  cancellation_reason: string | null;
  cancellation_note: string | null;
  rescheduled_from_appointment_id: string | null;
  rescheduled_to_appointment_id: string | null;
  reminder_eligible: boolean;
  visit_id: string | null;
  visit_status: 'ACTIVE' | 'COMPLETED' | 'ABORTED' | null;
  payment_id: string | null;
  payment_status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'VOID' | null;
  linked_followup_id: string | null;
  linked_followup_status: 'OPEN' | 'BOOKED' | 'CLOSED' | null;
  version: number;
  created_at: string;
};

export type AppointmentList = {
  items: Appointment[];
  total: number;
  limit: number;
  offset: number;
};

export type AppointmentCreatePayload = {
  patient_id: string;
  doctor_id: string;
  session_definition_id: string;
  appointment_date: string;
  appointment_time: string;
  appointment_type: 'REGULAR' | 'FOLLOW_UP';
  fee_adjustment?: { amount: string; reason: string };
  capacity_override?: { enabled: true; reason: string };
};

export type AppointmentReschedulePayload = {
  new_session_definition_id: string;
  new_appointment_date: string;
  new_appointment_time: string;
  capacity_override?: { enabled: true; reason: string };
};

export type AppointmentRescheduleResult = {
  original: Appointment;
  replacement: Appointment;
};
