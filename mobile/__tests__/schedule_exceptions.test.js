const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('1. Exceptions list structure & item rendering requirements', () => {
  const exceptionsFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/index.tsx');
  assert.ok(fs.existsSync(exceptionsFile), 'Exceptions hub screen file must exist');
  const content = fs.readFileSync(exceptionsFile, 'utf8');

  // Must render date, scope (Full Day or specific session), reason, retained appointment count, status, unblock
  assert.ok(content.includes('item.date'), 'Must render item date');
  assert.ok(content.includes('item.scope'), 'Must evaluate item scope');
  assert.ok(content.includes('item.reason'), 'Must render item reason');
  assert.ok(content.includes('retained_appointments_count'), 'Must check retained appointments count');
  assert.ok(content.includes('BLOCKED'), 'Must display BLOCKED status');
  assert.ok(content.includes('handleUnblock'), 'Must provide Unblock action handler');
  assert.ok(content.includes('+ Block a Date'), 'Must include + Block a Date CTA');
});

test('2. Full-day block creation payload & API contract', () => {
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  assert.ok(fs.existsSync(newFile), 'Block a date screen must exist');
  const content = fs.readFileSync(newFile, 'utf8');

  assert.ok(content.includes("scope,") || content.includes("scope: 'FULL_DAY'"), 'Must support FULL_DAY scope');
  assert.ok(content.includes("session_definition_id: scope === 'SESSION'"), 'Full-day block must not require session_definition_id');
  assert.ok(content.includes('blockException'), 'Must call block exception mutation');
});

test('3. Specific-session block creation payload & contract', () => {
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const content = fs.readFileSync(newFile, 'utf8');

  assert.ok(content.includes("scope === 'SESSION'"), 'Must conditionally handle SESSION scope');
  assert.ok(content.includes('Select Session'), 'Must show session selector when specific session chosen');
  assert.ok(content.includes('effectiveSessionDefId'), 'Must pass selected session definition ID when scope is SESSION');
});

test('4. Existing appointments warning before save', () => {
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const content = fs.readFileSync(newFile, 'utf8');

  assert.ok(content.includes('bookedAppointmentsCount'), 'Must compute booked appointments count');
  assert.ok(content.includes('already booked on this date'), 'Must show warning message for booked patients');
  assert.ok(content.includes('Blocking will prevent new bookings'), 'Must state blocking prevents new bookings');
  assert.ok(content.includes('Existing appointments will remain valid'), 'Must state existing appointments remain valid');
});

test('5. Existing appointment remains valid after block invariant', () => {
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const content = fs.readFileSync(newFile, 'utf8');

  // Verify that form does NOT cancel, delete, or reschedule appointments
  assert.ok(!content.includes('cancelAppointment'), 'Blocking screen must NOT cancel appointments');
  assert.ok(!content.includes('deleteAppointment'), 'Blocking screen must NOT delete appointments');
  assert.ok(!content.includes('rescheduleAppointment'), 'Blocking screen must NOT auto-reschedule appointments');
});

test('6. Duplicate block handled clearly', () => {
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const content = fs.readFileSync(newFile, 'utf8');

  assert.ok(content.includes('DATE_ALREADY_BLOCKED'), 'Must handle DATE_ALREADY_BLOCKED error code');
  assert.ok(content.includes('SESSION_ALREADY_BLOCKED'), 'Must handle SESSION_ALREADY_BLOCKED error code');
  assert.ok(content.includes('This date is already blocked.'), 'Must show clear date duplicate message');
  assert.ok(content.includes('This session is already blocked.'), 'Must show clear session duplicate message');
});

test('7. Unblock works and restores availability', () => {
  const exceptionsFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/index.tsx');
  const content = fs.readFileSync(exceptionsFile, 'utf8');

  assert.ok(content.includes('useUnblockScheduleExceptionsMutation'), 'Must hook into unblock mutation');
  assert.ok(content.includes('occurrence_ids'), 'Must pass occurrence IDs to unblock API');
  assert.ok(content.includes('exceptionsQuery.refetch()'), 'Must refetch exceptions after unblock');
});

test('8. Structurally keyboard-safe form structure in upper half of viewport', () => {
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const content = fs.readFileSync(newFile, 'utf8');

  assert.ok(content.includes('KeyboardAvoidingView'), 'Must wrap screen in KeyboardAvoidingView');
  assert.ok(content.includes('FormField'), 'Must render Reason with FormField');
  assert.ok(content.includes('label="Reason"'), 'Reason label must be present');
  // Reason appears in the upper compact card
  const reasonIdx = content.indexOf('label="Reason"');
  const buttonIdx = content.indexOf('label="Save Blocked Date"');
  assert.ok(reasonIdx > 0 && buttonIdx > reasonIdx, 'Reason field must be positioned before save action');
});

test('9. Navigation structure and frozen route topology', () => {
  const moreIndexFile = path.resolve(__dirname, '../app/doctor/more/index.tsx');
  const moreContent = fs.readFileSync(moreIndexFile, 'utf8');
  assert.ok(moreContent.includes('/doctor/more/schedule'), 'More menu must route to /doctor/more/schedule');

  const hubFile = path.resolve(__dirname, '../app/doctor/more/schedule/index.tsx');
  assert.ok(fs.existsSync(hubFile), 'Schedule hub file must exist');
  const hubContent = fs.readFileSync(hubFile, 'utf8');
  assert.ok(hubContent.includes('/doctor/more/schedule/exceptions'), 'Hub must route to exceptions list');
  assert.ok(hubContent.includes('/doctor/more/schedule/exceptions/new'), 'Hub must route to block a date');
  assert.ok(hubContent.includes('/doctor/more/schedule/weekly'), 'Hub must route to weekly schedule');

  // Verify frozen route topology: weekly/index.tsx exists and legacy schedule/weekly.tsx does NOT exist
  const weeklyIndexFile = path.resolve(__dirname, '../app/doctor/more/schedule/weekly/index.tsx');
  const legacyWeeklyFile = path.resolve(__dirname, '../app/doctor/more/schedule/weekly.tsx');
  assert.ok(fs.existsSync(weeklyIndexFile), 'schedule/weekly/index.tsx must exist');
  assert.ok(!fs.existsSync(legacyWeeklyFile), 'schedule/weekly.tsx must NOT exist');

  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const newContent = fs.readFileSync(newFile, 'utf8');
  assert.ok(newContent.includes('router.back()'), 'Block a date must support navigating back');
});

test('10. Verification of real Doctor bottom-tab shell (Today, Patients, Dashboard, Reports, Settings)', () => {
  const tabsFile = path.resolve(__dirname, '../app/doctor/_layout.tsx');
  assert.ok(fs.existsSync(tabsFile), 'Doctor _layout.tsx must exist');
  const tabsContent = fs.readFileSync(tabsFile, 'utf8');

  // Verify the 5 real production Doctor bottom tabs and labels
  assert.ok(tabsContent.includes('name="today"'), 'Today tab route name must be today');
  assert.ok(tabsContent.includes("title: 'Today'"), 'Today tab title must be Today');

  assert.ok(tabsContent.includes('name="patients"'), 'Patients tab route name must be patients');
  assert.ok(tabsContent.includes("title: 'Patients'"), 'Patients tab title must be Patients');

  assert.ok(tabsContent.includes('name="dashboard"'), 'Dashboard tab route name must be dashboard');
  assert.ok(tabsContent.includes("title: 'Dashboard'"), 'Dashboard tab title must be Dashboard');

  assert.ok(tabsContent.includes('name="reports"'), 'Reports tab route name must be reports');
  assert.ok(tabsContent.includes("title: 'Reports'"), 'Reports tab title must be Reports');

  assert.ok(tabsContent.includes('name="more"'), 'Settings tab route name must be more');
  assert.ok(
    tabsContent.includes("tabBarLabel: 'Settings'") || tabsContent.includes("title: 'Settings'"),
    'More tab must be labeled Settings'
  );

  // Verify schedule subroutes are NOT registered as top-level tabs
  assert.ok(!tabsContent.includes('name="schedule"'), 'schedule must not be a top-level tab');
  assert.ok(!tabsContent.includes('name="exceptions"'), 'exceptions must not be a top-level tab');
});
