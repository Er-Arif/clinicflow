const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

const tokenPair = {
  access_token: 'access-next',
  refresh_token: 'refresh-next',
  token_type: 'bearer',
  expires_in: 900,
  user: {
    user_id: 'user-1',
    clinic_id: 'clinic-1',
    display_name: 'Clinic User',
    roles: ['ASSISTANT'],
    permissions: [],
    must_change_password: false,
  },
};

function loadApiWithSession(fetchImpl) {
  let cleared = 0;
  let expired = 0;
  const stored = [];
  const runtime = mobileRuntime({
    '@/api/config': { getApiUrl: () => 'https://api.test.invalid' },
    '@/api/requestId': { newRequestId: () => 'request-1' },
    '@/auth/sessionEvents': { notifySessionExpired: () => { expired += 1; } },
    '@/auth/session': {
      getAccessToken: () => null,
      getRefreshToken: async () => 'refresh-current',
      setSessionTokens: async (tokens) => { stored.push(tokens); },
      clearSessionTokens: async () => { cleared += 1; },
    },
  });

  const originalFetch = global.fetch;
  global.fetch = fetchImpl;
  const loaded = runtime.load('src/api/api.ts');

  return {
    loaded,
    stored,
    get cleared() { return cleared; },
    get expired() { return expired; },
    restore() { global.fetch = originalFetch; },
  };
}

test('session refresh is single-flight across concurrent callers', async () => {
  let fetchCalls = 0;
  let releaseFetch;
  const harness = loadApiWithSession(() => {
    fetchCalls += 1;
    return new Promise((resolve) => {
      releaseFetch = () => resolve({
        ok: true,
        status: 200,
        json: async () => tokenPair,
      });
    });
  });

  try {
    const first = harness.loaded.refreshSessionSingleFlight();
    const second = harness.loaded.refreshSessionSingleFlight();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(fetchCalls, 1);
    releaseFetch();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(firstResult, tokenPair);
    assert.deepEqual(secondResult, tokenPair);
    assert.deepEqual(harness.stored, [tokenPair]);
    assert.equal(harness.cleared, 0);
    assert.equal(harness.expired, 0);
  } finally {
    harness.restore();
  }
});

test('temporary refresh network failure preserves the local session', async () => {
  const harness = loadApiWithSession(async () => {
    throw new Error('offline');
  });

  try {
    const result = await harness.loaded.refreshSessionSingleFlight();

    assert.equal(result, null);
    assert.deepEqual(harness.stored, []);
    assert.equal(harness.cleared, 0);
    assert.equal(harness.expired, 0);
  } finally {
    harness.restore();
  }
});

test('rejected refresh clears tokens and reports session expiry', async () => {
  const harness = loadApiWithSession(async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  }));

  try {
    const result = await harness.loaded.refreshSessionSingleFlight();

    assert.equal(result, null);
    assert.deepEqual(harness.stored, []);
    assert.equal(harness.cleared, 1);
    assert.equal(harness.expired, 1);
  } finally {
    harness.restore();
  }
});
