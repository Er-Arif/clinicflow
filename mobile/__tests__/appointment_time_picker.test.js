const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileRuntime } = require('./helpers/loadMobile');

const ready = data => ({ data, currentData: data, isLoading: false, isFetching: false, isError: false, isSuccess: true, refetch() {} });

function slotTime(index) {
  const minutes = index * 15;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

const session = {
  session_definition_id: 'session-1',
  name: 'Clinic session',
  start_time: '00:00:00',
  end_time: '23:45:00',
  used_capacity: 0,
  maximum_capacity: 12,
  remaining_capacity: 12,
  status: 'AVAILABLE',
  slots: Array.from({ length: 96 }, (_, index) => ({
    time: slotTime(index),
    normal_booking_allowed: true,
  })),
};

function renderBooking({ appointmentTime = '', modalVisible = false } = {}) {
  let stateIndex = 0;
  const calls = Array.from({ length: 8 }, () => []);
  const seeded = ['2026-10-27', 'doctor-1', 'FOLLOW_UP', 'session-1', appointmentTime, false, '', modalVisible];
  const runtime = mobileRuntime({
    react: {
      ...React,
      useState: initial => {
        const index = stateIndex++;
        const value = index < seeded.length ? seeded[index] : initial;
        return [value, next => { calls[index].push(next); }];
      },
    },
    'expo-router': {
      useLocalSearchParams: () => ({
        patientId: 'patient-1',
        appointmentType: 'FOLLOW_UP',
        followupId: 'followup-1',
        dueDate: '2026-10-27',
        doctorId: 'doctor-1',
      }),
      useRouter: () => ({ push() {}, back() {} }),
    },
    '@/api/api': {
      useGetPatientQuery: () => ready({ patient_id: 'patient-1', patient_code: 'PT-000004', full_name: 'Testing' }),
      useListDoctorsQuery: () => ready([{ doctor_id: 'doctor-1', display_name: 'Arif Ali' }]),
      useMeQuery: () => ready({ roles: ['ASSISTANT'] }),
      useClinicTimeQuery: () => ready({ clinic_date: '2026-10-20' }),
      useGetCurrentFeeQuery: () => ready({ regular_fee: '500.00', followup_fee: '300.00' }),
      useGetAvailabilityQuery: () => ready({ sessions: [session] }),
    },
  });

  return {
    ...runtime.render(runtime.load('app/assistant/appointments/new.tsx').default),
    calls,
  };
}

test('large appointment time picker stays scrollable and can always be dismissed', () => {
  const output = renderBooking({ modalVisible: true });
  const modal = output.controls.find(control => control.nativeType === 'Modal');
  const scroll = output.controls.find(control => control.nativeType === 'ScrollView');
  const backdrop = output.controls.find(control => control.accessibilityLabel === 'Dismiss time picker');
  const close = output.controls.find(control => control.label === 'Close');
  const slots = output.controls.filter(control => control.nativeType === 'Pressable' && /^\d{2}:\d{2} (AM|PM)$/.test(control.label));

  assert.equal(typeof modal.onRequestClose, 'function');
  assert.ok(scroll);
  assert.ok(backdrop);
  assert.ok(close);
  assert.equal(slots.length, 96);

  modal.onRequestClose();
  backdrop.onPress();
  close.onPress();
  assert.deepEqual(output.calls[7], [false, false, false]);
});

test('tapping the already selected session keeps the chosen appointment time', () => {
  const output = renderBooking({ appointmentTime: '02:30:00' });
  const selectedTime = output.controls.find(control => control.label === '02:30 AM');
  const sessionCard = output.controls.find(control => control.nativeType === 'Pressable' && String(control.label).includes('Clinic session'));

  assert.ok(selectedTime);
  assert.ok(sessionCard);
  sessionCard.onPress();
  assert.deepEqual(output.calls[3], []);
  assert.deepEqual(output.calls[4], []);
});
