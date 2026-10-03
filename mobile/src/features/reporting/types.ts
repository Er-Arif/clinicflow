export type OperationalAppointmentItem = {
  appointment_id: string;
  patient_id: string;
  patient_code: string;
  patient_name: string;
  appointment_time: string | null;
  appointment_type: 'REGULAR' | 'FOLLOW_UP';
  status: 'BOOKED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
  payment_status: string | null;
  checked_in_at: string | null;
};

export type AssistantHome = {
  clinic_date: string;
  appointments: number;
  booked: number;
  checked_in: number;
  completed: number;
  cancelled: number;
  pending_payments: number;
  due_reminders: number;
  overdue_followups: number;
  next_appointments: OperationalAppointmentItem[];
  checked_in_patients: OperationalAppointmentItem[];
};

export type DoctorToday = {
  date: string;
  total_appointments: number;
  checked_in_count: number;
  upcoming_count: number;
  checked_in: OperationalAppointmentItem[];
  upcoming: OperationalAppointmentItem[];
};

export type PatientOperationalSummary = {
  patient: {
    patient_id: string;
    patient_code: string;
    full_name: string;
    mobile_number: string;
    gender: string;
    age: number | null;
  };
  total_completed_visits: number;
  last_visit_date: string | null;
  upcoming_appointment: null | {
    appointment_id: string;
    date: string;
    appointment_time: string | null;
    appointment_type: string;
    status: string;
  };
  open_followup: null | {
    followup_id: string;
    due_date: string;
    overdue: boolean;
    status: string;
  };
  visit_history: Array<{
    visit_id: string;
    appointment_id: string;
    date: string;
    appointment_type: string;
    completed_at: string;
    payment_status: string | null;
    followup_status: string | null;
  }>;
};

export type OwnerDashboard = {
  date_from: string;
  date_to: string;
  appointments: number;
  checked_in: number;
  completed: number;
  cancelled: number;
  no_show: number;
  new_patients: number;
  returning_patient_visits: number;
  unique_patients: number;
  followup_appointments: number;
  confirmed_revenue: string;
  cash: string;
  upi: string;
  pending_amount: string;
};

export type AppointmentReport = {
  date_from: string;
  date_to: string;
  total_appointments: number;
  booked: number;
  checked_in: number;
  completed: number;
  cancelled: number;
  no_show: number;
  rescheduled: number;
};

export type PatientReport = {
  date_from: string;
  date_to: string;
  new_patients: number;
  returning_patient_visits: number;
  unique_patients: number;
};

export type FollowUpReport = {
  date_from: string;
  date_to: string;
  created: number;
  booked_events: number;
  closed_events: number;
  open_current: number;
  overdue_current: number;
};

export type PaymentReport = {
  date_from: string;
  date_to: string;
  confirmed_total: string;
  cash: string;
  upi: string;
  pending: string;
  confirmed_transaction_count: number;
  voided_payment_count: number;
};

export type AuditEvent = {
    audit_id: string;
    occurred_at: string;
    actor_type: 'USER' | 'SYSTEM';
    actor_user_id: string | null;
    actor_display_name: string | null;
    action_type: string;
    entity_type: string;
    entity_id: string | null;
    reason: string | null;
    previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  request_id: string;
};

export type AuditEventList = {
  items: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
};
