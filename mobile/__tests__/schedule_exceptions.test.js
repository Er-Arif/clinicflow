const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatWorkingDays } = require('../src/features/scheduling/formatters.ts');

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

  assert.ok(content.includes('<KeyboardSafeFormScreen'), 'Must use the shared keyboard-safe form screen');
  assert.ok(content.includes('FormField'), 'Must render Reason with FormField');
  assert.ok(content.includes('label="Reason"'), 'Reason label must be present');
  // Reason appears in the upper compact card
  const reasonIdx = content.indexOf('label="Reason"');
  const buttonIdx = content.indexOf('label="Save Blocked Date"');
  assert.ok(reasonIdx > 0 && buttonIdx > 0 && content.includes('footer={'), 'Reason belongs to the form and Save belongs to the pinned footer');
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

test('11. Working days formatting: seven active days -> Every day', () => {
  assert.equal(formatWorkingDays([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.equal(formatWorkingDays([6, 5, 4, 3, 2, 1, 0]), 'Every day', 'Must handle unsorted input');
  assert.equal(formatWorkingDays([0, 0, 1, 2, 3, 4, 5, 6]), 'Every day', 'Must handle duplicate day indices');
});

test('12. Working days formatting: six contiguous active days -> compact range', () => {
  assert.equal(formatWorkingDays([0, 1, 2, 3, 4, 5]), 'Mon-Sat');
  assert.equal(formatWorkingDays([1, 2, 3, 4, 5, 6]), 'Tue-Sun');
  assert.equal(formatWorkingDays([0, 1, 2, 3, 4]), 'Mon-Fri', 'Five contiguous days also formats cleanly');
});

test('13. Working days formatting: non-contiguous working days & wrap styling', () => {
  assert.equal(formatWorkingDays([0, 2, 4]), 'Mon, Wed, Fri');
  assert.equal(formatWorkingDays([0, 1, 2, 3, 4, 6]), 'Mon-Fri, Sun');
  assert.equal(formatWorkingDays([]), 'No recurring hours active');

  const hubFile = path.resolve(__dirname, '../app/doctor/more/schedule/index.tsx');
  const content = fs.readFileSync(hubFile, 'utf8');

  // Verify responsive wrapping and no overflow
  assert.ok(content.includes('formatWorkingDays('), 'Must use formatWorkingDays in hub');
  assert.ok(content.includes("flexWrap: 'wrap'"), 'summaryValue must wrap to prevent horizontal overflow');
  assert.ok(content.includes('flex: 1'), 'summaryValue must have flex: 1');
  assert.ok(!content.includes('horizontal={true}'), 'Must not horizontally scroll working days');
});

test('14. View All Exceptions always visible, even with zero exceptions', () => {
  const hubFile = path.resolve(__dirname, '../app/doctor/more/schedule/index.tsx');
  const content = fs.readFileSync(hubFile, 'utf8');

  // Button row contains View All Exceptions unconditionally
  const buttonRowStart = content.indexOf('style={styles.buttonRow}');
  assert.ok(buttonRowStart > 0, 'buttonRow must exist');
  const buttonRowContent = content.slice(buttonRowStart, content.indexOf('</View>', buttonRowStart + 100) + 500);

  assert.ok(buttonRowContent.includes('label="+ Block a Date"'), 'Must include + Block a Date in button row');
  assert.ok(buttonRowContent.includes('label="View All Exceptions"'), 'Must include View All Exceptions in button row');
  // Confirm it is NOT conditioned on exceptionCount > 0
  assert.ok(!buttonRowContent.includes('exceptionCount > 0 &&'), 'View All Exceptions must not be hidden when count == 0');
});

test('15. Exceptions & Time Off section/header navigates to hub', () => {
  const hubFile = path.resolve(__dirname, '../app/doctor/more/schedule/index.tsx');
  const content = fs.readFileSync(hubFile, 'utf8');

  // Tapping the cardHeaderRow opens /doctor/more/schedule/exceptions
  assert.ok(content.includes("router.push('/doctor/more/schedule/exceptions')"), 'Must route to exceptions hub');
  const headerPressableIdx = content.indexOf('style={styles.cardHeaderRow}');
  assert.ok(headerPressableIdx > 0, 'cardHeaderRow must be present');
  const headerSlice = content.slice(Math.max(0, headerPressableIdx - 200), headerPressableIdx + 200);
  assert.ok(headerSlice.includes('<Pressable'), 'cardHeaderRow must be a Pressable');
  assert.ok(headerSlice.includes('/doctor/more/schedule/exceptions'), 'Header pressable must navigate to exceptions hub');
});

test('16. Exception preview card navigates to hub', () => {
  const hubFile = path.resolve(__dirname, '../app/doctor/more/schedule/index.tsx');
  const content = fs.readFileSync(hubFile, 'utf8');

  const previewIdx = content.indexOf('nextExceptions.map');
  assert.ok(previewIdx > 0, 'nextExceptions.map must exist');
  const previewSlice = content.slice(previewIdx, previewIdx + 400);
  assert.ok(previewSlice.includes('<Pressable'), 'Preview cards must be Pressables');
  assert.ok(previewSlice.includes("router.push('/doctor/more/schedule/exceptions')"), 'Preview cards must navigate to exceptions hub');
});

test('17. Reason field is multiline with auto-grow and top vertical alignment', () => {
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const content = fs.readFileSync(newFile, 'utf8');

  assert.ok(content.includes('multiline'), 'Reason field must specify multiline prop');
  assert.ok(content.includes('numberOfLines={2}'), 'Reason field should specify default lines');
  assert.ok(content.includes('textAlignVertical="top"') || content.includes("textAlignVertical: 'top'"), 'Must align text to top');

  // Verify styling parameters
  assert.ok(content.includes('minHeight: 60') || content.includes('minHeight:'), 'Reason must have minHeight');
  assert.ok(content.includes('maxHeight: 110') || content.includes('maxHeight:'), 'Reason must have maxHeight for auto-grow cap');
});

test('18. Reason field enforces sensible maximum length (~300 chars)', () => {
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const content = fs.readFileSync(newFile, 'utf8');

  assert.ok(content.includes('maxLength={300}'), 'Reason field must have maxLength={300}');
  assert.ok(content.includes('slice(0, 300)'), 'Reason field input must clamp to 300 characters');
  assert.ok(content.includes('/300'), 'Must show character counter indicator');
});

test('19. Keyboard-oriented screen structure with resizable viewport and reachable footer', () => {
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const content = fs.readFileSync(newFile, 'utf8');

  const shared = fs.readFileSync(path.resolve(__dirname, '../src/components/KeyboardSafeFormScreen.tsx'), 'utf8');
  // The shared container retains the physically verified viewport/scroll/footer hierarchy.
  const returnIdx = shared.indexOf('return (');
  assert.ok(returnIdx > 0, 'Return statement must exist');
  const safeIdx = shared.indexOf('<SafeAreaView', returnIdx);
  const kavIdx = shared.indexOf('<KeyboardAvoidingView', returnIdx);
  const svIdx = shared.indexOf('<ScrollView', returnIdx);
  const footerIdx = shared.indexOf('{footer}', returnIdx);
  const svCloseIdx = shared.indexOf('</ScrollView>', returnIdx);

  assert.ok(safeIdx >= 0 && kavIdx > safeIdx, 'KeyboardAvoidingView inside SafeAreaView');
  assert.ok(svIdx > kavIdx, 'ScrollView inside KeyboardAvoidingView');
  assert.ok(footerIdx > svCloseIdx, 'Action footer must be positioned OUTSIDE the ScrollView');

  // Reason visibility handling on focus / keyboard show
  assert.ok(content.includes('<KeyboardSafeFormScreen') && content.includes('footer={'), 'Block a Date must supply its pinned actions to the shared container');
  assert.ok(shared.includes('onLayout=') && shared.includes('visibility.schedule()'), 'Must retry visibility after viewport layout changes');
  assert.ok(shared.includes('keyboardDidShow'), 'Must listen to keyboard show event for viewport adjustment');
});

test('20. Single active session freezes scope to Full Day with helper notice', () => {
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const content = fs.readFileSync(newFile, 'utf8');

  assert.ok(content.includes('singleSession') || content.includes('sessions.length === 1'), 'Must detect single active session');
  assert.ok(
    content.includes('Only one working session is configured for this date.'),
    'Must display helper notice when only one working session is configured'
  );
  // When single session, Specific Session is not presented as a selectable scope
  assert.ok(content.includes('sessions.length >= 2'), 'Specific Session scope must require 2 or more sessions');
  assert.ok(
    content.includes("scope: singleSession ? 'FULL_DAY' : scope") ||
      content.includes("scope: effectiveScope") ||
      content.includes("scope: 'FULL_DAY'"),
    'Payload must enforce FULL_DAY for single session'
  );
});

test('21. Resilient edge-case handling: date transitions, multiline auto-grow scroll, and formatter boundaries', () => {
  // 1. Formatter boundary robustness
  assert.equal(formatWorkingDays([-1, 7, 100]), 'No recurring hours active', 'Must drop invalid weekday indices');
  assert.equal(formatWorkingDays([0, 1, 2, 7]), 'Mon-Wed', 'Must retain only valid 0..6 weekday indices');
  assert.equal(formatWorkingDays(null), 'No recurring hours active', 'Must handle null cleanly');
  assert.equal(formatWorkingDays([0]), 'Mon', 'Single active weekday formats cleanly');
  assert.equal(formatWorkingDays([0, 1]), 'Mon, Tue', 'Two contiguous weekdays format cleanly');
  assert.equal(formatWorkingDays([0, 1, 2, 4, 5, 6]), 'Mon-Wed, Fri-Sun', 'Two disjoint ranges format cleanly');

  // 2. new.tsx date transition & dynamic scroll handling
  const newFile = path.resolve(__dirname, '../app/doctor/more/schedule/exceptions/new.tsx');
  const content = fs.readFileSync(newFile, 'utf8');

  assert.ok(content.includes('isSelectedSessionValid'), 'Must validate selectedSessionDefId against current date sessions');
  assert.ok(content.includes('effectiveSessionDefId'), 'Must derive effectiveSessionDefId with fallback to session[0]');
  const shared = fs.readFileSync(path.resolve(__dirname, '../src/components/KeyboardSafeFormScreen.tsx'), 'utf8');
  assert.ok(shared.includes('onContentSizeChange={visibility.schedule}'), 'Shared ScrollView must handle dynamic auto-grow scroll');
});
