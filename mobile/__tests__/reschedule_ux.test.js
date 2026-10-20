const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

const ready = data => ({ data, currentData: data, isSuccess: true, refetch() {} });

test('follow-up reschedule keeps patient context and shared time picker without duplicate cancel action', () => {
  const appointment = {
    appointment_id: 'a1',
    status: 'BOOKED',
    patient: { patient_id: 'p1', patient_code: 'PT-000004', full_name: 'Testing', mobile_number: '' },
    doctor: { doctor_id: 'd1', display_name: 'Arif Ali' },
    session: { session_occurrence_id: 'o1', session_definition_id: 's1', date: '2026-10-27', name: 'Clinic session', start_time: '00:00:00', end_time: '23:45:00' },
    appointment_time: '08:15:00',
    appointment_type: 'FOLLOW_UP',
    booking_source: 'ASSISTANT',
    effective_fee: '300.00',
    payment_status: null,
    linked_followup_id: 'f1',
    linked_followup_status: 'BOOKED',
  };
  const availability = {
    sessions: [{
      session_definition_id: 's1',
      name: 'Clinic session',
      status: 'OPEN',
      start_time: '00:00:00',
      end_time: '23:45:00',
      remaining_capacity: 11,
      slots: [{ time: '08:15:00', normal_booking_allowed: false }, { time: '08:30:00', normal_booking_allowed: true }],
    }],
  };

  const runtime = mobileRuntime({
    'expo-router': {
      useLocalSearchParams: () => ({ appointmentId: 'a1' }),
      useRouter: () => ({ back() {}, replace() {} }),
    },
    '@/api/api': {
      useGetAppointmentQuery: () => ready(appointment),
      useClinicTimeQuery: () => ready({ clinic_date: '2026-10-20', clinic_now: '2026-10-20T16:38:00+05:30', timezone: 'Asia/Kolkata' }),
      useGetAvailabilityQuery: () => ready(availability),
      useMeQuery: () => ready({ roles: ['ASSISTANT'] }),
      useRescheduleAppointmentMutation: () => [() => ({ unwrap: async () => ({}) }), {}],
    },
  });

  const output = runtime.render(runtime.load('app/assistant/appointments/reschedule.tsx').default);

  assert.match(output.markup, /Reschedule follow-up/);
  assert.match(output.markup, /Testing · PT-000004/);
  assert.match(output.markup, /Current: 27 Oct 2026 · 08:15 AM/);
  assert.ok(output.controls.some(control => control.accessibilityLabel === 'Close time picker'));
  assert.ok(output.controls.some(control => control.accessibilityLabel === 'Dismiss time picker'));
  assert.equal(output.controls.filter(control => control.nativeType === 'Pressable' && control.label === 'Cancel').length, 0);
  assert.equal(output.controls.filter(control => control.nativeType === 'Pressable' && control.accessibilityLabel === 'Back').length, 1);
});
