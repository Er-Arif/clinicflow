export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'VOID';
export type PaymentMethod = 'CASH' | 'UPI';

export type Payment = {
  payment_id: string;
  visit_id: string;
  patient_id: string;
  patient_code: string;
  patient_name: string;
  visit_date: string;
  appointment_type: 'REGULAR' | 'FOLLOW_UP';
  amount_due: string | number;
  amount_paid: string | number | null;
  payment_method: PaymentMethod | null;
  status: PaymentStatus;
  confirmation_source: 'ASSISTANT' | 'PROVIDER_API' | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  voided_at: string | null;
  void_reason: string | null;
  correction_of_payment_id: string | null;
  receipt_number: string | null;
  created_at: string;
};

export type PaymentList = {
  items: Payment[];
  total: number;
  limit: number;
  offset: number;
};

export type Receipt = {
  receipt_id: string;
  payment_id: string;
  receipt_number: string;
  issued_at: string;
  clinic_name: string;
  doctor_name: string;
  patient_name: string;
  appointment_type: 'REGULAR' | 'FOLLOW_UP';
  visit_date: string;
  amount: string | number;
  payment_method: PaymentMethod;
  voided: boolean;
};

export type PaymentConfirmation = {
  payment: Payment;
  receipt: Receipt;
};

export type PaymentVoidResult = {
  voided: Payment;
  replacement: Payment | null;
};

export type UpiIntent = {
  payment_id: string;
  amount: string | number;
  upi_id: string;
  payee_name: string;
  transaction_reference: string;
  note: string;
  upi_uri: string;
};

export type UpiConfiguration = {
  upi_configuration_id: string;
  upi_id: string;
  payee_name: string;
  active: boolean;
  version: number;
  updated_at: string;
};
