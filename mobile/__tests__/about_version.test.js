const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

const { compareVersions } = mobileRuntime().load('src/features/about/version.ts');

test('stable release outranks its prerelease', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
});

test('prerelease identifiers follow semantic version ordering', () => {
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.1'), 1);
  assert.equal(compareVersions('1.0.0-rc.10', '1.0.0-rc.2'), 1);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0-alpha'), 1);
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1);
});

test('core versions and optional v prefix compare correctly', () => {
  assert.equal(compareVersions('v1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('2.0.0+build.7', '2.0.0+build.4'), 0);
});

test('invalid versions fail closed', () => {
  assert.equal(compareVersions('latest', '1.0.0'), null);
  assert.equal(compareVersions('1.0.0', 'Unknown'), null);
  assert.equal(compareVersions('', '1.0.0'), null);
});
