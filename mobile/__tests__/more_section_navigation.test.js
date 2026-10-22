const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const route of ['payments', 'reminders']) {
  test(`${route} root returns explicitly to More`, () => {
    const source = fs.readFileSync(path.resolve(__dirname, `../app/assistant/${route}/index.tsx`), 'utf8');
    assert.match(source, /<BackButton\s+onPress=\{\(\) => router\.replace\('\/assistant\/more'\)\}\s*\/>/);
  });
}

test('custom BackButton actions automatically own Android hardware Back', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/components/BackButton.tsx'), 'utf8');
  assert.match(source, /useFocusedHardwareBack\(handlePress, Boolean\(onPress\)\)/);
});
