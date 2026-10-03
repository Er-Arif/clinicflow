export type ReminderStatus = 'DUE' | 'SENT' | 'SKIPPED';
export type ReminderType =
  | 'APPOINTMENT_CONFIRMATION'
  | 'APPOINTMENT_REMINDER'
  | 'APPOINTMENT_CANCELLED'
  | 'APPOINTMENT_RESCHEDULED'
  | 'FOLLOWUP_REMINDER';

export type Reminder = {
  reminder_id: string;
  patient_id: string;
  patient_name: string;
  whatsapp_number: string;
  appointment_id: string | null;
  followup_id: string | null;
  reminder_type: ReminderType;
  channel: 'WHATSAPP_APP';
  language: 'EN' | 'HI';
  due_on: string;
  due_at: string | null;
  status: ReminderStatus;
  message_snapshot: string | null;
  sent_at: string | null;
  skipped_at: string | null;
  skip_reason: string | null;
  sendable: boolean;
  suppression_reason: string | null;
};

export type ReminderList = {
  items: Reminder[];
  total: number;
  limit: number;
  offset: number;
};

export type PreparedMessage = {
  reminder: Reminder;
  rendered_message: string;
  whatsapp_url: string;
};

export type MessageTemplate = {
  template_id: string;
  template_type: ReminderType;
  language: 'EN' | 'HI';
  template_body: string;
  active: boolean;
  version: number;
  updated_at: string;
};
