const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');
const { resolveApiUrl } = mobileRuntime().load('src/api/config.ts');

test('production transport fails closed without an explicit HTTPS origin', () => {
  for (const raw of [undefined, '', 'http://192.168.1.2:8000', 'http://localhost', 'ftp://api.example.com']) {
    assert.throws(() => resolveApiUrl(raw, false, true));
  }
  assert.equal(resolveApiUrl('https://api.example.com/', false, false), 'https://api.example.com');
});

test('HTTP requires both a debug runtime and explicit developer opt-in', () => {
  assert.throws(() => resolveApiUrl('http://localhost:8000', true, false));
  assert.throws(() => resolveApiUrl('http://localhost:8000', false, true));
  assert.equal(resolveApiUrl('http://localhost:8000', true, true), 'http://localhost:8000');
});

test('origin parser rejects credentials and ambiguous URL components', () => {
  for (const raw of ['https://name:secret@api.example.com', 'https://api.example.com/api',
    'https://api.example.com?token=secret', 'https://api.example.com#fragment', 'invalid']) {
    assert.throws(() => resolveApiUrl(raw, false, false));
  }
});
