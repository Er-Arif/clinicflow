const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

test('appointment success screens cannot resurrect submitted booking or completion forms', () => {
  const booked = read('app/assistant/appointments/booked.tsx');
  const complete = read('app/assistant/appointments/complete.tsx');

  assert.match(booked, /useFocusedHardwareBack\(exitBooked\)/);
  assert.match(booked, /router\.dismissTo\('\/assistant\/appointments'\)/);
  assert.match(booked, /returnToAppointments: '1'/);

  assert.match(complete, /useFocusedHardwareBack\(exitCompleted, completed\)/);
  assert.match(complete, /router\.dismissTo\('\/assistant\/appointments'\)/);
  assert.doesNotMatch(complete, /label="Done"[^\n]*router\.replace\('\/assistant\/appointments'\)/);
});

test('reschedule replacement keeps a deterministic return target', () => {
  const detail = read('app/assistant/appointments/[appointmentId].tsx');
  const reschedule = read('app/assistant/appointments/reschedule.tsx');

  assert.match(detail, /returnToAppointments = params\.returnToAppointments === '1'/);
  assert.match(detail, /router\.dismissTo\('\/assistant\/appointments'\)/);
  assert.match(detail, /pathname: '\/assistant\/appointments\/reschedule'/);
  assert.match(detail, /returnToFollowupId \? \{ returnToFollowupId \} : returnToAppointments \? \{ returnToAppointments: '1' \}/);

  assert.match(reschedule, /returnToFollowupId = String\(params\.returnToFollowupId \?\? ''\)/);
  assert.match(reschedule, /pathname: '\/assistant\/appointments\/\[appointmentId\]'/);
  assert.match(reschedule, /returnToFollowupId \? \{ returnToFollowupId \} : \{ returnToAppointments: '1' \}/);
});

test('successful reminder send returns to its actual caller', () => {
  const preview = read('app/assistant/reminders/preview.tsx');
  assert.match(preview, /await markSent\(reminderId\)\.unwrap\(\);[\s\S]*router\.back\(\)/);
  assert.doesNotMatch(preview, /router\.replace\('\/assistant\/reminders'\)/);
});

test('follow-up booking unwinds to the existing follow-up instead of stacking a duplicate detail', () => {
  const book = read('app/assistant/followups/book.tsx');
  assert.match(book, /router\.dismissTo\(\{ pathname: '\/assistant\/followups\/\[followupId\]'/);
});

test('weekly schedule preview blocks Android Back whenever visible navigation is locked', () => {
  const editor = read('src/features/scheduling/WeeklyScheduleEditor.tsx');
  assert.match(editor, /const busy = state\.phase === 'previewing' \|\| state\.phase === 'applying' \|\| state\.phase === 'saved'/);
  assert.match(editor, /useFocusedHardwareBack\(\(\) => \{\}, busy\)/);
});
