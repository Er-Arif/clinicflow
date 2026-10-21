import type { Appointment } from '@/features/appointments/types';

export type FollowUpStatus = 'OPEN' | 'BOOKED' | 'CLOSED';

export type FollowUp = {
  followup_id: string;
  patient: {
    patient_id: string;
    patient_code: string;
    full_name: string;
    mobile_number: string | null;
  };
  source_visit_id: string;
  source_visit_date: string;
  doctor_id: string;
  due_date: string;
  interval_days: number | null;
  status: FollowUpStatus;
  overdue: boolean;
  linked_appointment: {
    appointment_id: string;
    date: string;
    time: string | null;
    status: string;
  } | null;
  close_reason: string | null;
  version: number;
  created_at: string;
  closed_at: string | null;
};

export type FollowUpList = {
  items: FollowUp[];
  total: number;
  limit: number;
  offset: number;
};

export type FollowUpBookPayload = {
  session_definition_id: string;
  appointment_date: string;
  appointment_time: string;
  capacity_override?: { enabled: true; reason: string };
};

export type FollowUpBookResult = {
  followup: FollowUp;
  appointment: Appointment;
};

export type VisitCompletionPayload = {
  follow_up?: { interval_days: number } | { due_date: string } | null;
  late_completion_reason?: string;
};

export type VisitCompletionResult = {
  appointment: Appointment;
  visit_id: string;
  visit_status: 'COMPLETED';
  completed_at: string;
  payment_status: string | null;
  followup: FollowUp | null;
  closed_previous_followup_id: string | null;
};
