const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

const ready = data => ({ data, currentData: data, isLoading: false, isFetching: false, isError: false, isSuccess: true, refetch: async () => {} });

const appointment = {
  appointment_id: 'appointment-1',
  visit_id: 'visit-1',
  status: 'CHECKED_IN',
  payment_status: 'PENDING',
  patient: { patient_id: 'patient-1', patient_code: 'PT-000004', full_name: 'Testing', mobile_number: '' },
  doctor: { doctor_id: 'doctor-1', display_name: 'Arif Ali' },
  session: { session_occurrence_id: 'occurrence-1', session_definition_id: 'session-1', date: '2026-10-19', name: 'Clinic session', start_time: '12:00:00', end_time: '15:00:00' },
  appointment_time: '01:00:00',
  appointment_type: 'FOLLOW_UP',
  booking_source: 'ASSISTANT',
  effective_fee: '300.00',
};

function runtimeFor(clinicDate) {
  return mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ appointmentId: 'appointment-1' }),
      useRouter: () => ({ back() {}, replace() {} }),
    },
    '@/api/api': {
      useGetAppointmentQuery: () => ready(appointment),
      useClinicTimeQuery: () => ready({ clinic_date: clinicDate, clinic_now: `${clinicDate}T10:00:00+05:30`, timezone: 'Asia/Kolkata' }),
      useCompleteVisitMutation: () => [() => ({ unwrap: async () => ({ followup: null }) }), {}],
    },
    '@/features/appointments/idempotency': {
      useIntentIdempotencyKey: () => ({ getKey: () => 'key', resultMatchesIntent: false }),
    },
  });
}

test('previous-day checked-in OPD visit requires explicit late-closure reason', () => {
  const runtime = runtimeFor('2026-10-20');
  const output = runtime.render(runtime.load('app/assistant/appointments/complete.tsx').default);

  assert.match(output.markup, /Resolve previous-day visit/);
  assert.match(output.markup, /Previous-day OPD visit left open/);
  assert.match(output.markup, /Visit date: 19 Oct 2026/);
  assert.match(output.markup, /without moving the clinical visit to today/);
  assert.ok(output.controls.some(control => control.placeholder === 'Why was this visit left open?'));
  const submit = output.controls.find(control => control.label === 'Close visit as completed');
  assert.ok(submit);
  assert.equal(submit.disabled, true);
  assert.equal(output.controls.filter(control => control.label === 'Cancel').length, 0);
});

test('same-day OPD visit remains the normal completion flow', () => {
  const runtime = runtimeFor('2026-10-19');
  const output = runtime.render(runtime.load('app/assistant/appointments/complete.tsx').default);

  assert.match(output.markup, /Complete visit/);
  assert.doesNotMatch(output.markup, /Previous-day OPD visit left open/);
  assert.equal(output.controls.some(control => control.placeholder === 'Why was this visit left open?'), false);
  assert.ok(output.controls.find(control => control.label === 'Complete visit'));
});
