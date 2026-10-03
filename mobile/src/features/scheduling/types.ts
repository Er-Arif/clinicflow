export type Doctor = {
  doctor_id: string;
  display_name: string;
  professional_display_details: string | null;
  active: boolean;
};

export type SessionDefinition = {
  session_definition_id: string;
  session_name: string;
  start_time: string;
  end_time: string;
  slot_interval_minutes: number;
  maximum_capacity: number;
  active: boolean;
  display_order: number;
};

export type ScheduleDay = {
  schedule_definition_id: string;
  doctor_id: string;
  weekday: number;
  effective_from: string;
  effective_to: string | null;
  active: boolean;
  version: number;
  sessions: SessionDefinition[];
};

export type WeeklySchedule = {
  doctor_id: string;
  effective_on: string;
  days: ScheduleDay[];
};

export type SessionWrite = {
  session_name: string;
  start_time: string;
  end_time: string;
  slot_interval_minutes: number;
  maximum_capacity: number;
  active: boolean;
  display_order: number;
};

export type AvailabilitySlot = {
  time: string;
  available: boolean;
  normal_booking_allowed: boolean;
};

export type AvailabilitySession = {
  session_occurrence_id: string | null;
  session_definition_id: string;
  materialized: boolean;
  name: string;
  start_time: string;
  end_time: string;
  status: 'AVAILABLE' | 'BLOCKED';
  slot_interval_minutes: number;
  maximum_capacity: number;
  used_capacity: number;
  remaining_capacity: number;
  slots: AvailabilitySlot[];
  blocked_reason: string | null;
};

export type AvailabilityResponse = {
  doctor_id: string;
  date: string;
  sessions: AvailabilitySession[];
};

export type FeeConfiguration = {
  fee_configuration_id: string;
  effective_from: string;
  effective_to: string | null;
  regular_fee: string | number;
  followup_fee: string | number;
  assistant_adjustment_allowed: boolean;
};
