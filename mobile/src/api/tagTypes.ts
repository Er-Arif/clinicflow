export const clinicFlowTagTypes = [
  'Patient',
  'Doctor',
  'Schedule',
  'Fee',
  'Appointment',
  'Visit',
  'Payment',
  'Upi',
  'FollowUp',
  'Reminder',
  'MessageTemplate',
  'Report',
  'User',
  'ClinicSettings',
  'DoctorSettings',
  'Audit',
] as const;

export type ClinicFlowTagType = (typeof clinicFlowTagTypes)[number];
export const clinicFlowReducerPath = 'clinicflowApi' as const;
