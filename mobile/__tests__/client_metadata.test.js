const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

test('mobile API headers include semantic version and Android versionCode', () => {
  const runtime = mobileRuntime();
  const { applyMobileClientHeaders, getMobileClientMetadata } = runtime.load(
    'src/api/clientMetadata.ts',
  );

  assert.deepEqual(getMobileClientMetadata(), {
    version: '1.0.0-rc.1',
    versionCode: 1,
  });

  const headers = applyMobileClientHeaders(new Headers());
  assert.equal(headers.get('x-clinicflow-mobile-version'), '1.0.0-rc.1');
  assert.equal(headers.get('x-clinicflow-mobile-version-code'), '1');
});

test('invalid native metadata is omitted instead of spoofed', () => {
  const runtime = mobileRuntime({
    'expo-constants': {
      __esModule: true,
      default: {
        expoConfig: {
          version: '   ',
          android: { versionCode: 0 },
        },
      },
    },
  });
  const { applyMobileClientHeaders, getMobileClientMetadata } = runtime.load(
    'src/api/clientMetadata.ts',
  );

  assert.deepEqual(getMobileClientMetadata(), {
    version: null,
    versionCode: null,
  });

  const headers = applyMobileClientHeaders(new Headers());
  assert.equal(headers.has('x-clinicflow-mobile-version'), false);
  assert.equal(headers.has('x-clinicflow-mobile-version-code'), false);
});
