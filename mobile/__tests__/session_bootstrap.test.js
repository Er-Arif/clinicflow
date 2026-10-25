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

function loadBootstrap({ refreshResult = null, refreshError = null, storedRefreshToken = null } = {}) {
  const runtime = mobileRuntime({
    '@/api/api': {
      refreshSessionSingleFlight: async () => {
        if (refreshError) throw refreshError;
        return refreshResult;
      },
    },
    '@/auth/session': {
      getRefreshToken: async () => storedRefreshToken,
    },
  });
  return runtime.load('src/auth/bootstrap.ts');
}

test('bootstrap continues when session refresh succeeds', async () => {
  const { bootstrapSession } = loadBootstrap({ refreshResult: tokenPair });
  assert.deepEqual(await bootstrapSession(), { status: 'authenticated', tokens: tokenPair });
});

test('bootstrap keeps the local session when refresh is temporarily unavailable', async () => {
  const { bootstrapSession } = loadBootstrap({ storedRefreshToken: 'refresh-current' });
  assert.deepEqual(await bootstrapSession(), { status: 'retry' });
});

test('bootstrap signs out only when no refresh token remains', async () => {
  const { bootstrapSession } = loadBootstrap();
  assert.deepEqual(await bootstrapSession(), { status: 'signed-out' });
});

test('bootstrap uses retry state when refresh throws unexpectedly', async () => {
  const { bootstrapSession } = loadBootstrap({
    refreshError: new Error('temporary bootstrap failure'),
    storedRefreshToken: 'refresh-current',
  });
  assert.deepEqual(await bootstrapSession(), { status: 'retry' });
});
