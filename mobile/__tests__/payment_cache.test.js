const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

const ready = data => ({ data, currentData: data, isSuccess: true, refetch() {} });

test('appointment payment navigation carries appointment and visit context', () => {
  let destination;
  const appointment = {
    appointment_id: 'a1',
    status: 'CHECKED_IN',
    patient: { full_name: 'UAT Patient' },
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
      useCheckInAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCancelAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
      useCreateAppointmentMessageMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
    },
  });

  const output = runtime.render(runtime.load('app/assistant/appointments/[appointmentId].tsx').default);
  output.controls.find(control => control.label === 'Collect Payment').onPress();

  assert.deepEqual(destination, {
    pathname: '/assistant/payments/[paymentId]',
    params: { paymentId: 'pay1', appointmentId: 'a1', visitId: 'visit1' },
  });
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
  output.controls.find(control => control.label === 'Confirm ₹500.00 Cash').onPress();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(confirmationArg.appointmentId, 'a1');
  assert.equal(confirmationArg.visitId, 'visit1');
  assert.equal(confirmationArg.paymentId, 'pay1');
  assert.equal(confirmationArg.paymentMethod, 'CASH');
  assert.deepEqual(destination, { pathname: '/assistant/payments/receipt', params: { paymentId: 'pay1' } });
});
