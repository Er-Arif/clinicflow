const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileRuntime } = require('./helpers/loadMobile');

const ready = data => ({ data, currentData: data, isLoading: false, isFetching: false, isError: false, isSuccess: true, refetch() {} });

const followup = {
  followup_id: 'followup-1',
  patient: { patient_id: 'patient-1', patient_code: 'PT-000004', full_name: 'Testing', mobile_number: null },
  source_visit_id: 'visit-1',
  source_visit_date: '2026-10-20',
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

const session = {
  session_definition_id: 'session-1',
  name: 'Clinic session',
  start_time: '12:00:00',
  end_time: '15:00:00',
  used_capacity: 0,
  maximum_capacity: 12,
  remaining_capacity: 12,
  status: 'AVAILABLE',
  slots: [{ time: '12:00:00', available: true, normal_booking_allowed: true }],
};

test('follow-up detail opens the dedicated follow-up booking route with a single Back action', () => {
  let destination;
  const runtime = mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ followupId: 'followup-1' }),
      useRouter: () => ({ push: value => { destination = value; }, back() {} }),
    },
    '@/api/api': {
      useGetFollowUpQuery: () => ready(followup),
      useListRemindersQuery: () => ready({ items: [] }),
      useCloseFollowUpMutation: () => [() => {}, {}],
    },
  });

  const output = runtime.render(runtime.load('app/assistant/followups/[followupId].tsx').default);
  assert.equal(output.controls.filter(control => control.accessibilityLabel === 'Back').length, 1);
  output.controls.find(control => control.label === 'Book appointment').onPress();
  assert.deepEqual(destination, { pathname: '/assistant/followups/book', params: { followupId: 'followup-1' } });
});

test('completed visit shortcut stays inside Follow-ups and opens dedicated booking', () => {
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
      useRouter: () => ({ back() {}, replace: value => { destination = value; } }),
    },
    '@/api/api': {
      useGetAppointmentQuery: () => ({ data: { appointment_id: 'appointment-1', visit_id: 'visit-1', payment_status: 'PENDING', patient: { patient_id: 'patient-1', full_name: 'Testing' } }, isLoading: false, refetch: async () => {} }),
      useCompleteVisitMutation: () => [() => {}, {}],
    },
    '@/features/appointments/idempotency': { useIntentIdempotencyKey: () => ({ getKey: () => 'key', reset() {}, resultMatchesIntent: false }) },
  });

  const output = runtime.render(runtime.load('app/assistant/appointments/complete.tsx').default);
  output.controls.find(control => control.label === 'Book follow-up now').onPress();
  assert.deepEqual(destination, { pathname: '/assistant/followups/book', params: { followupId: 'followup-1' } });
});

test('dedicated follow-up booking locks type, doctor and upcoming recommendation date', () => {
  const runtime = mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ followupId: 'followup-1' }),
      useRouter: () => ({ back() {}, replace() {} }),
    },
    '@/api/api': {
      useGetFollowUpQuery: () => ready(followup),
      useClinicTimeQuery: () => ready({ clinic_date: '2026-10-20' }),
      useListDoctorsQuery: () => ready([{ doctor_id: 'doctor-1', display_name: 'Arif Ali' }]),
      useGetCurrentFeeQuery: () => ready({ regular_fee: '500.00', followup_fee: '300.00' }),
      useMeQuery: () => ready({ permissions: [] }),
      useGetAvailabilityQuery: args => { assert.deepEqual(args, { doctorId: 'doctor-1', date: '2026-10-27' }); return ready({ sessions: [session] }); },
      useBookFollowUpMutation: () => [() => {}, {}],
    },
    '@/features/appointments/idempotency': { useIntentIdempotencyKey: () => ({ getKey: () => 'key', resultMatchesIntent: false }) },
  });

  const output = runtime.render(runtime.load('app/assistant/followups/book.tsx').default);
  assert.match(output.markup, /Book follow-up/);
  assert.match(output.markup, /27 Oct 2026/);
  assert.match(output.markup, /Arif Ali/);
  assert.match(output.markup, /₹300\.00/);
  assert.doesNotMatch(output.markup, />Regular</);
  assert.equal(output.controls.some(control => control.accessibilityLabel === 'Follow-up appointment date'), false);
  assert.equal(output.controls.some(control => control.nativeType === 'DateTimePicker'), false);
  assert.match(output.markup, /12:00 PM/);
});

test('booked follow-up detail uses clear hierarchy and a green booked status', () => {
  const booked = {
    ...followup,
    status: 'BOOKED',
    linked_appointment: {
      appointment_id: 'appointment-1',
      date: '2026-10-27',
      time: '08:15:00',
      status: 'BOOKED',
    },
  };
  const runtime = mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ followupId: 'followup-1' }),
      useRouter: () => ({ push() {}, back() {} }),
    },
    '@/api/api': {
      useGetFollowUpQuery: () => ready(booked),
      useListRemindersQuery: () => ready({ items: [] }),
      useCloseFollowUpMutation: () => [() => {}, {}],
    },
  });

  const output = runtime.render(runtime.load('app/assistant/followups/[followupId].tsx').default);
  const { colors } = runtime.load('src/theme/tokens');
  const bookedStatus = output.controls.find(control => control.nativeType === 'Text' && control.label === 'Booked');
  const bookedStyles = [bookedStatus.style].flat(2).filter(Boolean);

  assert.match(output.markup, /Follow-up details/);
  assert.match(output.markup, />Patient</);
  assert.match(output.markup, /Testing/);
  assert.match(output.markup, /Patient ID/);
  assert.match(output.markup, /PT-000004/);
  assert.match(output.markup, /Appointment date/);
  assert.match(output.markup, /27 Oct 2026/);
  assert.match(output.markup, /Appointment time/);
  assert.match(output.markup, /08:15 AM/);
  assert.ok(bookedStatus);
  assert.ok(bookedStyles.some(style => style.color === colors.success));
});
