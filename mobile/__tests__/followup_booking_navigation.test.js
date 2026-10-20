const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileRuntime } = require('./helpers/loadMobile');

const followup = {
  followup_id: 'followup-1',
  patient: {
    patient_id: 'patient-1',
    patient_code: 'PT-000004',
    full_name: 'Testing',
    mobile_number: null,
  },
  source_visit_id: 'visit-1',
  source_visit_date: '2026-10-19',
  doctor_id: 'doctor-1',
  due_date: '2026-10-27',
  interval_days: 7,
  status: 'OPEN',
  overdue: false,
  linked_appointment: null,
  close_reason: null,
  version: 1,
  created_at: '2026-10-20T08:57:00Z',
  closed_at: null,
};

test('follow-up booking params preserve the saved recommendation context', () => {
  const { followUpBookingParams } = mobileRuntime().load('src/features/followups/navigation.ts');
  assert.deepEqual(followUpBookingParams(followup), {
    patientId: 'patient-1',
    appointmentType: 'FOLLOW_UP',
    followupId: 'followup-1',
    dueDate: '2026-10-27',
    doctorId: 'doctor-1',
  });
});

test('Book follow-up now carries the saved due date and doctor into appointment booking', () => {
  let stateIndex = 0;
  const seededState = [false, 'INTERVAL', '7', '', followup, true];
  let destination;
  const runtime = mobileRuntime({
    react: {
      ...React,
      useState: initial => {
        const index = stateIndex++;
        return [index < seededState.length ? seededState[index] : initial, () => {}];
      },
    },
    'expo-router': {
      useLocalSearchParams: () => ({ appointmentId: 'appointment-1' }),
      useRouter: () => ({
        back() {},
        replace: value => { destination = value; },
      }),
    },
    '@/api/api': {
      useGetAppointmentQuery: () => ({
        data: {
          appointment_id: 'appointment-1',
          visit_id: 'visit-1',
          payment_status: 'PENDING',
          patient: { patient_id: 'patient-1', full_name: 'Testing' },
        },
        isLoading: false,
        refetch: async () => {},
      }),
      useCompleteVisitMutation: () => [() => {}, {}],
    },
    '@/features/appointments/idempotency': {
      useIntentIdempotencyKey: () => ({ getKey: () => 'key', reset() {}, resultMatchesIntent: false }),
    },
  });

  const output = runtime.render(runtime.load('app/assistant/appointments/complete.tsx').default);
  output.controls.find(control => control.label === 'Book follow-up now').onPress();

  assert.deepEqual(destination, {
    pathname: '/assistant/appointments/new',
    params: {
      patientId: 'patient-1',
      appointmentType: 'FOLLOW_UP',
      followupId: 'followup-1',
      dueDate: '2026-10-27',
      doctorId: 'doctor-1',
    },
  });
});
