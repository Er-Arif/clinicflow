const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileRuntime } = require('./helpers/loadMobile');

const ready = data => ({ data, currentData: data, isLoading: false, isFetching: false, isError: false, isSuccess: true, refetch: async () => {} });

const baseAppointment = {
  appointment_id: 'appointment-1',
  visit_id: null,
  status: 'BOOKED',
  payment_status: null,
  payment_id: null,
  patient: { patient_id: 'patient-1', patient_code: 'PT-000004', full_name: 'Testing', mobile_number: '' },
  doctor: { doctor_id: 'doctor-1', display_name: 'Arif Ali' },
  session: { session_occurrence_id: 'occurrence-1', session_definition_id: 'session-1', date: '2026-10-27', name: 'Clinic session', start_time: '00:00:00', end_time: '23:45:00' },
  appointment_time: '20:30:00',
  appointment_type: 'FOLLOW_UP',
  booking_source: 'ASSISTANT',
  base_fee: '300.00',
  effective_fee: '300.00',
  fee_adjusted: false,
  capacity_override_used: false,
  cancellation_reason: null,
  cancellation_note: null,
  rescheduled_from_appointment_id: null,
  rescheduled_to_appointment_id: null,
  reminder_eligible: false,
  linked_followup_id: 'followup-1',
  linked_followup_status: 'BOOKED',
  version: 1,
  created_at: '2026-10-21T06:00:00Z',
};

function renderAppointment(appointment, clinicDate, clinicNow, showCancel = true) {
  let stateIndex = 0;
  const seededState = [showCancel, 'PATIENT_CANCELLED', '', null];
  const runtime = mobileRuntime({
    react: {
      ...React,
      useState: initial => {
        const index = stateIndex++;
        return [index < seededState.length ? seededState[index] : initial, () => {}];
      },
    },
    'expo-router': {
      useLocalSearchParams: () => ({ appointmentId: appointment.appointment_id }),
      useRouter: () => ({ push() {}, back() {} }),
    },
    '@/api/api': {
      useGetAppointmentQuery: () => ready(appointment),
      useGetPatientQuery: () => ready({ reminders_enabled: false }),
      useClinicTimeQuery: () => ready({ clinic_date: clinicDate, clinic_now: clinicNow, timezone: 'Asia/Kolkata' }),
      useCheckInAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCancelAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCreateAppointmentMessageMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
    },
    '@/features/appointments/idempotency': {
      useIntentIdempotencyKey: () => ({ getKey: () => 'key', resultMatchesIntent: false }),
    },
    'react-native-safe-area-context': {
      useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 48, left: 0 }),
    },
  });
  return runtime.render(runtime.load('app/assistant/appointments/[appointmentId].tsx').default);
}

test('appointment detail stays quiet until cancellation is opened', () => {
  const output = renderAppointment(
    baseAppointment,
    '2026-10-21',
    '2026-10-21T12:26:00+05:30',
    false,
  );

  assert.match(output.markup, /Check-in available on 27 Oct 2026/);
  assert.doesNotMatch(output.markup, /Messaging is unavailable/);
  assert.doesNotMatch(output.markup, /reopen the linked follow-up/);
  assert.equal(output.controls.some(control => control.label === 'Keep appointment'), false);
  assert.ok(output.controls.find(control => control.label === 'Cancel appointment'));
});

test('future linked follow-up cancellation uses a compact sheet and hides no-show', () => {
  const output = renderAppointment(
    baseAppointment,
    '2026-10-21',
    '2026-10-21T12:26:00+05:30',
  );

  const modal = output.controls.find(control => control.nativeType === 'Modal');
  assert.ok(modal);
  assert.equal(typeof modal.onRequestClose, 'function');
  assert.match(output.markup, /Testing · 27 Oct 2026 · 08:30 PM/);
  assert.match(output.markup, /This will reopen the linked follow-up/);
  assert.equal(output.controls.some(control => control.label === 'No show'), false);
  assert.ok(output.controls.find(control => control.label === 'Keep appointment'));
  assert.ok(output.controls.find(control => control.accessibilityLabel === 'Dismiss cancellation'));
  assert.ok(output.controls.find(control => control.accessibilityLabel === 'Close cancellation'));
  assert.doesNotMatch(output.markup, /Cancel and reopen follow-up|Hide cancellation|Messaging is unavailable/);
});

test('no-show becomes available only after the scheduled appointment time', () => {
  const appointment = {
    ...baseAppointment,
    appointment_type: 'REGULAR',
    linked_followup_id: null,
    linked_followup_status: null,
    session: { ...baseAppointment.session, date: '2026-10-21' },
  };
  const output = renderAppointment(
    appointment,
    '2026-10-21',
    '2026-10-21T21:00:00+05:30',
  );

  assert.ok(output.controls.find(control => control.label === 'No show'));
  assert.ok(output.controls.find(control => control.label === 'Keep appointment'));
  assert.doesNotMatch(output.markup, /reopen the linked follow-up/);
});
