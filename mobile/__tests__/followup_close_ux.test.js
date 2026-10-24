const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileRuntime } = require('./helpers/loadMobile');

const ready = data => ({ data, currentData: data, isLoading: false, isFetching: false, isError: false, isSuccess: true, refetch: async () => {} });

const followup = {
  followup_id: 'followup-1',
  patient: { patient_id: 'patient-1', patient_code: 'PT-000004', full_name: 'Testing', mobile_number: '' },
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
  created_at: '2026-10-19T10:00:00Z',
  closed_at: null,
};

function renderFollowup(showClose) {
  let stateIndex = 0;
  const seededState = [showClose, 'PATIENT_DECLINED', ''];
  const runtime = mobileRuntime({
    react: {
      ...React,
      useState: initial => {
        const index = stateIndex++;
        return [index < seededState.length ? seededState[index] : initial, () => {}];
      },
    },
    'expo-router': {
      useLocalSearchParams: () => ({ followupId: followup.followup_id }),
      useRouter: () => ({ push() {}, back() {} }),
    },
    '@/api/api': {
      useGetFollowUpQuery: () => ready(followup),
      useListRemindersQuery: () => ready({ items: [], total: 0, limit: 50, offset: 0 }),
      useCloseFollowUpMutation: () => [() => ({ unwrap: async () => ({ ...followup, status: 'CLOSED' }) }), {}],
    },
  });
  return runtime.render(runtime.load('app/assistant/followups/[followupId].tsx').default);
}

test('follow-up detail stays focused until closure is opened', () => {
  const output = renderFollowup(false);

  assert.ok(output.controls.find(control => control.label === 'Book appointment'));
  assert.ok(output.controls.find(control => control.label === 'Close follow-up'));
  assert.equal(output.controls.some(control => control.nativeType === 'Modal'), false);
  assert.doesNotMatch(output.markup, /stops follow-up reminders/);
  assert.equal(output.controls.some(control => control.label === 'Keep open'), false);
});

test('follow-up closure uses a compact bottom sheet with resolved semantics', () => {
  const output = renderFollowup(true);

  const modal = output.controls.find(control => control.nativeType === 'Modal');
  assert.ok(modal);
  assert.equal(typeof modal.onRequestClose, 'function');
  assert.match(output.markup, /Testing · Due 27 Oct 2026/);
  assert.match(output.markup, /Closing removes this follow-up from active queues and stops follow-up reminders/);
  assert.ok(output.controls.find(control => control.label === 'Patient declined'));
  assert.ok(output.controls.find(control => control.label === 'No longer required'));
  assert.ok(output.controls.find(control => control.label === 'Contacted, resolved'));
  assert.ok(output.controls.find(control => control.label === 'Other'));
  assert.ok(output.controls.find(control => control.label === 'Keep open'));
  assert.ok(output.controls.find(control => control.accessibilityLabel === 'Dismiss follow-up closure'));
  assert.ok(output.controls.find(control => control.accessibilityLabel === 'Close follow-up closure'));
  assert.equal(output.controls.some(control => control.label === 'Confirm close'), false);
});
