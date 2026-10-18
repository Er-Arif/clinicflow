export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY';
export type MessageLanguage = 'EN' | 'HI';

export type Patient = {
  patient_id: string;
  patient_code: string;
  full_name: string;
  mobile_number: string;
  whatsapp_number: string;
  whatsapp_same_as_mobile: boolean;
  date_of_birth: string | null;
  approximate_age_years: number | null;
  age_as_of_date: string | null;
  age: number;
  gender: Gender;
  preferred_language: MessageLanguage;
  reminders_enabled: boolean;
  previous_completed_visits: number;
  last_visit_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type PatientList = {
  items: Patient[];
  total: number;
  limit: number;
  offset: number;
};

export type DuplicateCandidate = {
  patient_id: string;
  patient_code: string;
  full_name: string;
  mobile_number: string;
  gender: Gender;
  age: number;
  last_visit_date: string | null;
  previous_completed_visits: number;
};

export type PatientCreatePayload = {
  full_name: string;
  mobile_number: string | null;
  whatsapp_same_as_mobile: boolean;
  whatsapp_number?: string | null;
  date_of_birth?: string;
  approximate_age_years?: number;
  gender: Gender;
  preferred_language: MessageLanguage;
  reminders_enabled: boolean;
  allow_shared_mobile?: boolean;
};

export type PatientUpdatePayload = Partial<
  Omit<PatientCreatePayload, 'allow_shared_mobile' | 'date_of_birth' | 'approximate_age_years'>
> & {
  expected_version: number;
  allow_shared_mobile?: boolean;
  date_of_birth?: string | null;
  approximate_age_years?: number | null;
};
