const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, `../${relativePath}`), 'utf8');
}

test('home Appointments metric opens the Booked appointment filter', () => {
  const home = source('app/assistant/home.tsx');
  assert.match(home, /type AppointmentFilter = 'BOOKED' \| 'CHECKED_IN' \| 'COMPLETED' \| 'CANCELLED'/);
  assert.match(home, /label="Appointments"[\s\S]{0,180}openAppointments\('BOOKED'\)/);
});

test('patient search fields expose a visible clear action', () => {
  for (const file of [
    'app/assistant/patients/index.tsx',
    'app/assistant/walk-in.tsx',
    'app/doctor/patients/index.tsx',
  ]) {
    const content = source(file);
    assert.match(content, /accessibilityLabel="Clear search"/);
    assert.match(content, /onPress=\{\(\) => setQuery\(''\)\}/);
    assert.match(content, />×<\/Text>/);
  }
});

test('Follow-up uses the singular visible tab and page heading', () => {
  const layout = source('app/assistant/_layout.tsx');
  const followups = source('app/assistant/followups/index.tsx');
  assert.match(layout, /name="followups"[\s\S]{0,180}tabBarLabel: 'Follow-up'/);
  assert.match(followups, /<Text style=\{styles\.title\}>Follow-up<\/Text>/);
});
