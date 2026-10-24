const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('appointments stack keeps index as the root for cross-tab deep links', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../app/assistant/appointments/_layout.tsx'), 'utf8');
  assert.match(source, /export const unstable_settings\s*=\s*\{[\s\S]*initialRouteName:\s*'index'/);
});
