const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

test('mobile update-required events subscribe and unsubscribe cleanly', () => {
  const runtime = mobileRuntime();
  const {
    notifyMobileUpdateRequired,
    subscribeMobileUpdateRequired,
  } = runtime.load('src/features/about/updateEvents.ts');

  let calls = 0;
  const unsubscribe = subscribeMobileUpdateRequired(() => {
    calls += 1;
  });

  notifyMobileUpdateRequired();
  assert.equal(calls, 1);

  unsubscribe();
  notifyMobileUpdateRequired();
  assert.equal(calls, 1);
});
