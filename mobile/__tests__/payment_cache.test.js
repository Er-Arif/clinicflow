const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

const ready = data => ({ data, currentData: data, isLoading: false, isFetching: false, isError: false, isSuccess: true, refetch() {} });
const intentKey = { useIntentIdempotencyKey: () => ({ getKey: () => 'key', resultMatchesIntent: false, reset() {} }) };

test('appointment payment navigation carries appointment and visit context', () => {
  let destination;
  const appointment = {
    appointment_id: 'a1',
    status: 'CHECKED_IN',
    patient: { patient_id: 'patient-1', full_name: 'UAT Patient' },
    session: { date: '2026-10-17', name: 'Staging UAT Session' },
    doctor: { display_name: 'Arif Ali' },
    appointment_time: null,
    appointment_type: 'REGULAR',
    effective_fee: '500.00',
    booking_source: 'WALK_IN',
    visit_status: 'ACTIVE',
    payment_status: 'PENDING',
    payment_id: 'pay1',
    visit_id: 'visit1',
    linked_followup_status: null,
    cancellation_reason: null,
    rescheduled_from_appointment_id: null,
  };
  const runtime = mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ appointmentId: 'a1' }),
      useRouter: () => ({ push: value => { destination = value; }, replace() {}, back() {} }),
    },
    '@/api/api': {
      useGetAppointmentQuery: () => ready(appointment),
      useGetPatientQuery: () => ready({ patient_id: 'patient-1', reminders_enabled: false }),
      useClinicTimeQuery: () => ready({ clinic_date: '2026-10-17' }),
      useCheckInAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCancelAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCreateAppointmentMessageMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
    },
    '@/features/appointments/idempotency': intentKey,
  });

  const output = runtime.render(runtime.load('app/assistant/appointments/[appointmentId].tsx').default);
  output.controls.find(control => control.label === 'Collect payment').onPress();

  assert.deepEqual(destination, {
    pathname: '/assistant/payments/[paymentId]',
    params: { paymentId: 'pay1', appointmentId: 'a1', visitId: 'visit1' },
  });
});

test('future appointment hides check-in and unavailable messaging actions', () => {
  const appointment = {
    appointment_id: 'future-1',
    status: 'BOOKED',
    patient: { patient_id: 'patient-1', full_name: 'Testing' },
    session: { date: '2026-10-27', name: 'Clinic session' },
    doctor: { display_name: 'Arif Ali' },
    appointment_time: '08:15:00',
    appointment_type: 'FOLLOW_UP',
    effective_fee: '300.00',
    payment_status: null,
    payment_id: null,
    visit_id: null,
    cancellation_reason: null,
    rescheduled_from_appointment_id: null,
  };
  const runtime = mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ appointmentId: 'future-1' }),
      useRouter: () => ({ push() {}, replace() {}, back() {} }),
    },
    '@/api/api': {
      useGetAppointmentQuery: () => ready(appointment),
      useGetPatientQuery: () => ready({
        patient_id: 'patient-1',
        mobile_number: '',
        whatsapp_number: '',
        reminders_enabled: false,
      }),
      useClinicTimeQuery: () => ready({ clinic_date: '2026-10-20' }),
      useCheckInAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCancelAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCreateAppointmentMessageMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
    },
    '@/features/appointments/idempotency': intentKey,
  });

  const output = runtime.render(runtime.load('app/assistant/appointments/[appointmentId].tsx').default);

  assert.equal(output.controls.some(control => control.label === 'Check in'), false);
  assert.equal(output.controls.some(control => control.label === 'Send confirmation'), false);
  assert.match(output.markup, /Check in is only available on the scheduled clinic date \(27 Oct 2026\)\./);
  assert.match(output.markup, /Messaging is unavailable for this patient\./);
  assert.ok(output.controls.some(control => control.label === 'Reschedule'));
  assert.ok(output.controls.some(control => control.label === 'Cancel appointment'));
});

test('same-day WhatsApp-only patient keeps valid check-in and messaging actions', () => {
  const appointment = {
    appointment_id: 'today-1',
    status: 'BOOKED',
    patient: { patient_id: 'patient-2', full_name: 'WhatsApp Patient' },
    session: { date: '2026-10-27', name: 'Clinic session' },
    doctor: { display_name: 'Arif Ali' },
    appointment_time: '09:00:00',
    appointment_type: 'REGULAR',
    effective_fee: '500.00',
    payment_status: null,
    payment_id: null,
    visit_id: null,
    cancellation_reason: null,
    rescheduled_from_appointment_id: null,
  };
  const runtime = mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ appointmentId: 'today-1' }),
      useRouter: () => ({ push() {}, replace() {}, back() {} }),
    },
    '@/api/api': {
      useGetAppointmentQuery: () => ready(appointment),
      useGetPatientQuery: () => ready({
        patient_id: 'patient-2',
        mobile_number: '',
        whatsapp_number: '+919999999999',
        reminders_enabled: true,
      }),
      useClinicTimeQuery: () => ready({ clinic_date: '2026-10-27' }),
      useCheckInAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCancelAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCreateAppointmentMessageMutation: () => [() => ({ unwrap: async () => ({ reminder: { reminder_id: 'r1' } }) }), {}],
    },
    '@/features/appointments/idempotency': intentKey,
  });

  const output = runtime.render(runtime.load('app/assistant/appointments/[appointmentId].tsx').default);

  assert.ok(output.controls.some(control => control.label === 'Check in'));
  assert.ok(output.controls.some(control => control.label === 'Send confirmation'));
  assert.doesNotMatch(output.markup, /Messaging is unavailable for this patient\./);
});

test('cash confirmation forwards appointment and visit ids so detail caches are invalidated', async () => {
  let confirmationArg;
  let destination;
  const runtime = mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ paymentId: 'pay1', appointmentId: 'a1', visitId: 'visit1' }),
      useRouter: () => ({ replace: value => { destination = value; }, push() {}, back() {} }),
    },
    '@/api/api': {
      useGetPaymentQuery: () => ready({
        payment_id: 'pay1', patient_name: 'UAT Patient', patient_code: 'P001', visit_date: '2026-10-17',
        appointment_type: 'REGULAR', amount_due: '500.00', amount_paid: null, payment_method: null,
        status: 'PENDING', receipt_number: null, void_reason: null,
      }),
      useMeQuery: () => ready({ permissions: [] }),
      useConfirmPaymentMutation: () => [arg => {
        confirmationArg = arg;
        return { unwrap: async () => ({ payment: { payment_id: 'pay1' } }) };
      }, {}],
      useVoidPaymentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
    },
  });

  const output = runtime.render(runtime.load('app/assistant/payments/[paymentId].tsx').default);
  output.controls.find(control => control.label === 'Confirm ₹500.00 cash').onPress();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(confirmationArg.appointmentId, 'a1');
  assert.equal(confirmationArg.visitId, 'visit1');
  assert.equal(confirmationArg.paymentId, 'pay1');
  assert.equal(confirmationArg.paymentMethod, 'CASH');
  assert.deepEqual(destination, { pathname: '/assistant/payments/receipt', params: { paymentId: 'pay1' } });
});
