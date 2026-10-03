export type RolePreset = {
  role_code: 'ASSISTANT' | 'DOCTOR' | 'OWNER_ADMIN';
  display_name: string;
};

export type AdminUser = {
  user_id: string;
  display_name: string;
  login_identifier: string;
  active: boolean;
  must_change_password: boolean;
  roles: Array<'ASSISTANT' | 'DOCTOR' | 'OWNER_ADMIN'>;
  linked_doctor_id: string | null;
  last_login_at: string | null;
  version: number;
};

export type UserList = { items: AdminUser[] };

export type ClinicSettings = {
  clinic_id: string;
  clinic_name: string;
  address: string | null;
  contact_number: string | null;
  version: number;
};

export type DoctorSettings = {
  doctor_id: string;
  user_id: string | null;
  display_name: string;
  professional_display_details: string | null;
  active: boolean;
  version: number;
};
