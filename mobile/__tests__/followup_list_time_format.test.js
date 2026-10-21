const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = () => fs.readFileSync(path.resolve(__dirname, '../app/assistant/followups/index.tsx'), 'utf8');

test('follow-up worklist formats linked appointment times in 12-hour display', () => {
  const text = source();
  assert.match(text, /formatClinicTime\(item\.linked_appointment\.time\)/);
  assert.doesNotMatch(text, /linked_appointment\.time\?\.slice\(0, 5\)/);
});

test('follow-up worklist keeps zero-count states compact instead of rendering four empty sections', () => {
  const text = source();
  assert.match(text, /summaryGrid/);
  assert.match(text, /summaryCard/);
  assert.match(text, /if \(items\.length === 0 && !query\.isError\) return null/);
  assert.doesNotMatch(text, /No \$\{title\.toLowerCase\(\)\} follow-ups/);
  assert.doesNotMatch(text, /items\.length} of/);
});

test('follow-up cards are lightweight tappable summaries rather than nested Open buttons', () => {
  const text = source();
  assert.match(text, /accessibilityLabel={`Open follow-up for \$\{item\.patient\.full_name\}`}/);
  assert.match(text, /View details ›/);
  assert.match(text, /Appointment ·/);
  assert.doesNotMatch(text, /<AppButton label="Open"/);
});
