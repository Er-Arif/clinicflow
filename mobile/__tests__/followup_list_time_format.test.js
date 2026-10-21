const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('follow-up worklist formats linked appointment times in 12-hour display', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../app/assistant/followups/index.tsx'), 'utf8');
  assert.match(source, /formatClinicTime\(item\.linked_appointment\.time\)/);
  assert.doesNotMatch(source, /linked_appointment\.time\?\.slice\(0, 5\)/);
});
