const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mobileRuntime } = require('./helpers/loadMobile');

const root = path.resolve(__dirname, '..');

test('request keys stay stable for the same intent and change for different request data', () => {
  const { getOrCreateIdempotencyKey } = mobileRuntime().load('src/features/appointments/idempotency.ts');
  const keys = new Map();
  const first = getOrCreateIdempotencyKey(keys, 'walkin', 'patient-a');
  const retry = getOrCreateIdempotencyKey(keys, 'walkin', 'patient-a');
  const changed = getOrCreateIdempotencyKey(keys, 'walkin', 'patient-b');
  const backToFirst = getOrCreateIdempotencyKey(keys, 'walkin', 'patient-a');

  assert.equal(retry, first);
  assert.notEqual(changed, first);
  assert.equal(backToFirst, first);
});

test('mutable submission screens bind idempotency results to the current request intent', () => {
  const files = [
    'app/assistant/walk-in.tsx',
    'app/assistant/appointments/reschedule.tsx',
    'app/assistant/appointments/review.tsx',
    'app/assistant/followups/book.tsx',
    'app/assistant/payments/[paymentId].tsx',
    'app/assistant/payments/upi.tsx',
    'app/assistant/appointments/[appointmentId].tsx',
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /useIntentIdempotencyKey/);
    assert.doesNotMatch(source, /useState\(\(\) => newIdempotencyKey/);
  }

  const walkIn = fs.readFileSync(path.join(root, 'app/assistant/walk-in.tsx'), 'utf8');
  assert.match(walkIn, /resultMatchesIntent \? apiError\(addState\.error\) : null/);
  assert.match(walkIn, /walkInRequest\.reset\(\)/);
});
