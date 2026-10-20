import type { FollowUp } from '@/features/followups/types';

export type FollowUpBookingParams = {
  patientId: string;
  appointmentType: 'FOLLOW_UP';
  followupId: string;
  dueDate: string;
  doctorId: string;
};

export function followUpBookingParams(
  followup: Pick<FollowUp, 'followup_id' | 'due_date' | 'doctor_id' | 'patient'>,
): FollowUpBookingParams {
  return {
    patientId: followup.patient.patient_id,
    appointmentType: 'FOLLOW_UP',
    followupId: followup.followup_id,
    dueDate: followup.due_date,
    doctorId: followup.doctor_id,
  };
}
