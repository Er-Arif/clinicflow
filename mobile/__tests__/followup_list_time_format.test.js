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

test('follow-up worklist is queue-first rather than a dashboard clone', () => {
  const text = source();
  assert.match(text, /filterBar/);
  assert.match(text, /filterChip/);
  assert.match(text, /setSelected\(state\)/);
  assert.doesNotMatch(text, /summaryGrid|summaryCard/);
  assert.match(text, /const activeState = selected \?\? preferredState/);
  assert.match(text, /WorklistControls\s*\n\s*query=\{activeQuery\}/);
});

test('follow-up queue defaults to the most useful non-empty state', () => {
  const text = source();
  assert.match(text, /totalFor\(overdue\) > 0/);
  assert.match(text, /totalFor\(due\) > 0/);
  assert.match(text, /totalFor\(upcoming\) > 0/);
  assert.match(text, /totalFor\(booked\) > 0/);
});

test('follow-up rows are compact tappable records without duplicate status chrome', () => {
  const text = source();
  assert.match(text, /accessibilityLabel={`Open follow-up for \$\{item\.patient\.full_name\}`}/);
  assert.match(text, /<Text style=\{styles\.chevron\}>›<\/Text>/);
  assert.doesNotMatch(text, /View details ›/);
  assert.doesNotMatch(text, /statusPill|summaryCount/);
  assert.doesNotMatch(text, /<AppButton label="Open"/);
});
