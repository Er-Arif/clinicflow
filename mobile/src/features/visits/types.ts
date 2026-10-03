import type { Appointment } from '@/features/appointments/types';

export type PaymentSummary = {
  payment_id: string;
  visit_id: string;
  amount_due: string | number;
  amount_paid: string | number | null;
  payment_method: 'CASH' | 'UPI' | null;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'VOID';
  created_at: string;
};

export type Visit = {
  visit_id: string;
  appointment_id: string;
  patient_id: string;
  doctor_id: string;
  visit_type: 'REGULAR' | 'FOLLOW_UP';
  status: 'ACTIVE' | 'COMPLETED' | 'ABORTED';
  checked_in_at: string;
  completed_at: string | null;
  aborted_at: string | null;
  payment: PaymentSummary | null;
};

export type CheckInResult = {
  appointment: Appointment;
  visit: Visit;
  payment: PaymentSummary;
};

export type WalkInPayload = {
  patient_id: string;
  doctor_id: string;
  session_definition_id: string;
  appointment_type: 'REGULAR' | 'FOLLOW_UP';
  fee_adjustment?: { amount: string; reason: string };
  capacity_override?: { enabled: true; reason: string };
};
