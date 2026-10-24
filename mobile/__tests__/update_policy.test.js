const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

const { evaluateUpdate } = mobileRuntime().load('src/features/about/updatePolicy.ts');

function policy(overrides = {}) {
  return {
    minimum_mobile_version: '1.0.0-rc.1',
    minimum_mobile_version_code: 1,
    latest_mobile_version: '1.0.0',
    latest_mobile_version_code: 2,
    mobile_update_mandatory: false,
    ...overrides,
  };
}

test('higher Android versionCode makes an update available', () => {
  assert.deepEqual(
    evaluateUpdate({ version: '1.0.0-rc.1', versionCode: 1 }, policy()),
    { state: 'available', mandatory: false },
  );
});

test('installed versionCode at or above latest is current', () => {
  assert.deepEqual(
    evaluateUpdate({ version: '1.0.0', versionCode: 2 }, policy()),
    { state: 'current', mandatory: false },
  );
  assert.deepEqual(
    evaluateUpdate({ version: '1.1.0', versionCode: 3 }, policy()),
    { state: 'current', mandatory: false },
  );
});

test('minimum versionCode makes older installations mandatory', () => {
  assert.deepEqual(
    evaluateUpdate(
      { version: '1.0.0-rc.1', versionCode: 1 },
      policy({ minimum_mobile_version_code: 2 }),
    ),
    { state: 'available', mandatory: true },
  );
});

test('explicit mandatory policy applies only when an update exists', () => {
  assert.deepEqual(
    evaluateUpdate(
      { version: '1.0.0-rc.1', versionCode: 1 },
      policy({ mobile_update_mandatory: true }),
    ),
    { state: 'available', mandatory: true },
  );
  assert.deepEqual(
    evaluateUpdate(
      { version: '1.0.0', versionCode: 2 },
      policy({ mobile_update_mandatory: true }),
    ),
    { state: 'current', mandatory: false },
  );
});

test('invalid build or version metadata fails closed', () => {
  assert.deepEqual(
    evaluateUpdate({ version: '1.0.0', versionCode: null }, policy()),
    { state: 'unavailable', mandatory: false },
  );
  assert.deepEqual(
    evaluateUpdate(
      { version: '1.0.0', versionCode: 1 },
      policy({ latest_mobile_version: 'latest' }),
    ),
    { state: 'unavailable', mandatory: false },
  );
  assert.deepEqual(
    evaluateUpdate(
      { version: '1.0.0', versionCode: 1 },
      policy({ minimum_mobile_version_code: 3, latest_mobile_version_code: 2 }),
    ),
    { state: 'unavailable', mandatory: false },
  );
});
