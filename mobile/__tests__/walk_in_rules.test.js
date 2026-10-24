const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

const rules = mobileRuntime().load('src/features/visits/walkInRules.ts');

function session(overrides = {}) {
  return {
    session_occurrence_id: null,
    session_definition_id: 'session-1',
    materialized: false,
    name: 'Morning',
    start_time: '09:00:00',
    end_time: '12:00:00',
    status: 'AVAILABLE',
    slot_interval_minutes: 15,
    maximum_capacity: 12,
    used_capacity: 0,
    remaining_capacity: 12,
    slots: [],
    blocked_reason: null,
    ...overrides,
  };
}

test('active walk-in session uses inclusive start and exclusive end time', () => {
  const morning = session();
  const afternoon = session({
    session_definition_id: 'session-2',
    name: 'Afternoon',
    start_time: '12:00:00',
    end_time: '15:00:00',
  });

  assert.equal(rules.findActiveWalkInSession([morning, afternoon], '2026-10-25T09:00:00+05:30'), morning);
  assert.equal(rules.findActiveWalkInSession([morning, afternoon], '2026-10-25T11:59:59+05:30'), morning);
  assert.equal(rules.findActiveWalkInSession([morning, afternoon], '2026-10-25T12:00:00+05:30'), afternoon);
  assert.equal(rules.findActiveWalkInSession([morning, afternoon], '2026-10-25T15:00:00+05:30'), null);
});

test('active walk-in session is absent without sessions or clinic time', () => {
  assert.equal(rules.findActiveWalkInSession(undefined, '2026-10-25T10:00:00+05:30'), null);
  assert.equal(rules.findActiveWalkInSession([session()], undefined), null);
});

test('suggested fee follows appointment type and preserves configured value formatting', () => {
  const fee = { regular_fee: '500.00', followup_fee: 300 };

  assert.equal(rules.getSuggestedWalkInFee(fee, 'REGULAR'), '500.00');
  assert.equal(rules.getSuggestedWalkInFee(fee, 'FOLLOW_UP'), '300');
  assert.equal(rules.getSuggestedWalkInFee(undefined, 'REGULAR'), '');
});

test('fee adjustment requires a valid amount and a meaningful reason only when enabled', () => {
  assert.equal(rules.isWalkInFeeAdjustmentValid(false, '', ''), true);
  assert.equal(rules.isWalkInFeeAdjustmentValid(true, '500', 'ok'), true);
  assert.equal(rules.isWalkInFeeAdjustmentValid(true, '500.50', '  ok  '), true);
  assert.equal(rules.isWalkInFeeAdjustmentValid(true, '500.555', 'ok'), false);
  assert.equal(rules.isWalkInFeeAdjustmentValid(true, '', 'ok'), false);
  assert.equal(rules.isWalkInFeeAdjustmentValid(true, '500', 'x'), false);
});

test('capacity override is needed only for a full session and requires owner approval details', () => {
  assert.equal(rules.canSubmitWalkInCapacityOverride(false, false, false, ''), true);
  assert.equal(rules.canSubmitWalkInCapacityOverride(true, false, true, 'approved'), false);
  assert.equal(rules.canSubmitWalkInCapacityOverride(true, true, false, 'approved'), false);
  assert.equal(rules.canSubmitWalkInCapacityOverride(true, true, true, 'x'), false);
  assert.equal(rules.canSubmitWalkInCapacityOverride(true, true, true, 'approved'), true);
});
