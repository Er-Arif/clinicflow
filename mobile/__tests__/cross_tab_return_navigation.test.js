const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

const ready = data => ({ data, currentData: data, isLoading: false, isFetching: false, isError: false, isSuccess: true, refetch() {} });

const bookedFollowup = {
  followup_id: 'followup-1',
  patient: { patient_id: 'patient-1', patient_code: 'PT-000003', full_name: 'No Phone UAT', mobile_number: null },
  source_visit_id: 'visit-1',
  source_visit_date: '2026-10-21',
  doctor_id: 'doctor-1',
  due_date: '2026-10-28',
  interval_days: 7,
  status: 'BOOKED',
  overdue: false,
  linked_appointment: {
    appointment_id: 'appointment-1',
    date: '2026-10-28',
    time: '20:30:00',
    status: 'BOOKED',
  },
  close_reason: null,
  version: 1,
  created_at: '2026-10-21T09:40:00Z',
  closed_at: null,
};

const appointment = {
  appointment_id: 'appointment-1',
  status: 'BOOKED',
  patient: { patient_id: 'patient-1', full_name: 'No Phone UAT' },
  session: { date: '2026-10-28', name: 'Clinic session' },
  doctor: { display_name: 'Arif Ali' },
  appointment_time: '20:30:00',
  appointment_type: 'FOLLOW_UP',
  effective_fee: '300.00',
  payment_status: null,
  payment_id: null,
  visit_id: null,
  linked_followup_id: 'followup-1',
  linked_followup_status: 'BOOKED',
  cancellation_reason: null,
  rescheduled_from_appointment_id: null,
};

test('opening a booked follow-up appointment carries the follow-up return target', () => {
  let destination;
  const runtime = mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ followupId: 'followup-1' }),
      useRouter: () => ({ push: value => { destination = value; }, back() {} }),
    },
    '@/api/api': {
      useGetFollowUpQuery: () => ready(bookedFollowup),
      useListRemindersQuery: () => ready({ items: [] }),
      useCloseFollowUpMutation: () => [() => {}, {}],
    },
  });

  const output = runtime.render(runtime.load('app/assistant/followups/[followupId].tsx').default);
  output.controls.find(control => control.label === 'Open appointment').onPress();

  assert.deepEqual(destination, {
    pathname: '/assistant/appointments/[appointmentId]',
    params: {
      appointmentId: 'appointment-1',
      returnToFollowupId: 'followup-1',
    },
  });
});

test('appointment Back returns to the originating follow-up instead of stale appointment history', () => {
  let replaced;
  let backed = false;
  const runtime = mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ appointmentId: 'appointment-1', returnToFollowupId: 'followup-1' }),
      useRouter: () => ({
        push() {},
        replace: value => { replaced = value; },
        back: () => { backed = true; },
      }),
    },
    '@/api/api': {
      useGetAppointmentQuery: () => ready(appointment),
      useGetPatientQuery: () => ready({ patient_id: 'patient-1', reminders_enabled: false }),
      useClinicTimeQuery: () => ready({ clinic_date: '2026-10-21', clinic_now: '2026-10-21T15:19:00+05:30' }),
      useCheckInAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCancelAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCreateAppointmentMessageMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
    },
    '@/features/appointments/idempotency': {
      useIntentIdempotencyKey: () => ({ getKey: () => 'key', resultMatchesIntent: false, reset() {} }),
    },
  });

  const output = runtime.render(runtime.load('app/assistant/appointments/[appointmentId].tsx').default);
  output.controls.find(control => control.accessibilityLabel === 'Back').onPress();

  assert.deepEqual(replaced, {
    pathname: '/assistant/followups/[followupId]',
    params: { followupId: 'followup-1' },
  });
  assert.equal(backed, false);
});
