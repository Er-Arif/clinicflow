const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileRuntime } = require('./helpers/loadMobile');

const ready = data => ({ data, currentData: data, isSuccess: true, refetch() {} });
const failed = { isError: true, isFetching: false, refetch() {} };
const baseline = { clinic_now: '2026-10-15T23:59:58+05:30', clinic_date: '2026-10-15', timezone: 'Asia/Kolkata' };

test('clinic clock advances across midnight using server baseline, independent of device date/timezone', () => {
  const { clinicInstant, clinicClockParts } = mobileRuntime().load('src/features/reporting/clinicClock.ts');
  const received = Date.parse('2020-01-01T00:00:00Z');
  const current = clinicClockParts(clinicInstant(baseline, received, received + 3000), baseline.timezone);
  assert.equal(current.date, '2026-10-16');
  assert.equal(current.time, '00:00:01');
  assert.equal(current.displayTime, '12:00 AM');
  assert.match(current.compactDate, /Fri/);
  assert.match(current.readableDate, /Friday/);
});

test('live clock ticks every second without refetching; resume resynchronizes and cleanup stops ticking', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 100_000, state = now, effect, resume, options, requests = 0, updates = 0, removed = false;
  t.mock.method(Date, 'now', () => now);
  const runtime = mobileRuntime({
    react: { ...React, useState: () => [state, value => { state = value; updates++; }], useEffect: fn => { effect = fn; } },
    'react-native': { AppState: { addEventListener: (_event, fn) => { resume = fn; return { remove() { removed = true; } }; } } },
    '@/api/api': { useClinicTimeQuery: (_arg, opts) => { options = opts; return { ...ready(baseline), fulfilledTimeStamp: 100_000, refetch() { requests++; } }; } },
  });
  const { useClinicClock } = runtime.load('src/features/reporting/useClinicClock.ts');
  assert.equal(useClinicClock().clock.time, '23:59:58');
  const cleanup = effect();
  for (let i = 0; i < 3; i++) { now += 1000; t.mock.timers.tick(1000); }
  assert.equal(useClinicClock().clock.time, '00:00:01');
  assert.equal(updates, 3); assert.equal(requests, 0); assert.equal(options.pollingInterval, 60_000);
  resume('background'); assert.equal(requests, 0); resume('active'); assert.equal(requests, 1);
  cleanup(); const before = updates; t.mock.timers.tick(5000); assert.equal(updates, before); assert.ok(removed);
});

test('Today counts retain server totals and upcoming excludes past, checked-in, completed, cancelled and untimed rows', () => {
  const { todaySummary } = mobileRuntime().load('src/features/reporting/today.ts');
  const rows = [['future', 'BOOKED', '15:00:00'], ['past', 'BOOKED', '09:00:00'], ['in', 'CHECKED_IN', '15:00:00'], ['done', 'COMPLETED', '16:00:00'], ['cancel', 'CANCELLED', '17:00:00'], ['untimed', 'BOOKED', null]].map(([appointment_id, status, appointment_time]) => ({ appointment_id, status, appointment_time }));
  const data = { date: '2026-10-15', total_appointments: 150, checked_in_count: 102, upcoming_count: 106, upcoming: rows, checked_in: rows.filter(r => r.status === 'CHECKED_IN') };
  const summary = todaySummary(data, data.date, '14:26:42');
  assert.equal(summary.appointments, 150); assert.equal(summary.checkedInCount, 102); assert.equal(summary.upcomingCount, 101); assert.deepEqual(summary.upcoming.map(r => r.appointment_id), ['future']); assert.equal(todaySummary(data, '2026-10-16', '00:00:00'), null);
});

test('Doctor Today renders compact 12-hour clinic clock, session chips and patient navigation', () => {
  const clock = { date: '2026-10-15', time: '14:26:42', displayTime: '02:26 PM', compactDate: 'Thu, 15 Oct', readableDate: 'Thursday, 15 October 2026', greeting: 'Good afternoon' };
  const row = { appointment_id: 'a1', patient_id: 'p1', patient_name: 'Asha', appointment_time: '15:00:00', appointment_type: 'REGULAR', status: 'BOOKED' };
  let destination;
  const runtime = mobileRuntime({
    '@/features/reporting/useClinicClock': { useClinicClock: () => ({ clock, query: ready(baseline) }) },
    '@/api/api': { useGetDoctorTodayQuery: () => ready({ date: clock.date, total_appointments: 3, checked_in_count: 0, upcoming_count: 1, upcoming: [row], checked_in: [] }), useListDoctorsQuery: () => ready([{ doctor_id: 'd1', display_name: 'Dr. Rao' }]), useGetScheduleQuery: () => ready({ days: [{ weekday: 3, active: true, sessions: [{ active: true, session_definition_id: 's1', session_name: 'Evening', start_time: '15:00:00', end_time: '18:00:00' }] }] }) },
    'expo-router': { useRouter: () => ({ push: value => { destination = value; } }) },
  });
  const output = runtime.render(runtime.load('app/doctor/today.tsx').default);
  assert.match(output.markup, /02:26 PM/); assert.match(output.markup, /Thu, 15 Oct/); assert.match(output.markup, /Evening/); assert.match(output.markup, /03:00 PM/); assert.doesNotMatch(output.markup, /Asia\/Kolkata|14:26:42/);
  output.controls.find(c => c.label === 'View Asha').onPress(); assert.equal(destination, '/doctor/patients/p1');
});

test('report range presets, custom fields and reversed/oversized range validation', () => {
  const runtime = mobileRuntime(); const { quickRange, rangeError, DateRangeControls } = runtime.load('src/components/DateRangeControls.tsx');
  assert.deepEqual(quickRange('Today', '2026-10-15'), { from: '2026-10-15', to: '2026-10-15' }); assert.deepEqual(quickRange('Week', '2026-10-15'), { from: '2026-10-12', to: '2026-10-15' }); assert.deepEqual(quickRange('Month', '2026-10-15'), { from: '2026-10-01', to: '2026-10-15' });
  let selected; const selection = { range: quickRange('Today', '2026-10-15'), preset: 'Today', error: null, select: value => { selected = value; }, setCustom() {} };
  let output = runtime.render(DateRangeControls, { today: '2026-10-15', selection }); output.controls.find(c => c.label === 'Month' && c.onPress).onPress(); assert.equal(selected, 'Month'); output.controls.find(c => c.label === 'Custom range').onPress(); assert.equal(selected, 'Custom'); output = runtime.render(DateRangeControls, { today: '2026-10-15', selection: { ...selection, preset: 'Custom' } }); assert.ok(output.controls.find(c => c.label === 'Range start date')); assert.ok(output.controls.find(c => c.label === 'Range end date')); assert.match(rangeError({ from: '2026-10-16', to: '2026-10-15' }), /on or after/); assert.match(rangeError({ from: '2024-01-01', to: '2026-10-15' }), /367/); assert.ok(rangeError({ from: '2026-02-30', to: '2026-03-01' }));
});

test('time and timestamp formatting is 12-hour while picker/storage values stay 24-hour', () => {
  const before = process.env.TZ; try { process.env.TZ = 'America/Los_Angeles'; const { pickerDate, formatClinicDate, formatClinicTime, formatClinicTimestamp } = mobileRuntime().load('src/utils/dates.ts'); const date = pickerDate('2026-10-15'); assert.equal(date.getFullYear(), 2026); assert.equal(date.getMonth(), 9); assert.equal(date.getDate(), 15); assert.equal(formatClinicDate('2026-10-15'), '15 Oct 2026'); assert.equal(formatClinicTime('00:05:00'), '12:05 AM'); assert.equal(formatClinicTime('15:30:00'), '03:30 PM'); assert.match(formatClinicTimestamp('2026-10-15T09:00:00Z', 'Asia/Kolkata'), /02:30 PM/); } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
});

test('custom report dates update the real range hook and quick presets reset them', () => {
  const states = []; let cursor = 0; const runtime = mobileRuntime({ react: { ...React, useState: initial => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], next => { states[index] = next; }]; } } }); const { useReportRange } = runtime.load('src/components/DateRangeControls.tsx'); const render = () => { cursor = 0; return useReportRange('2026-10-15'); }; let selection = render(); selection.select('Custom'); selection = render(); selection.setCustom({ from: '2026-09-01', to: '2026-09-30' }); selection = render(); assert.deepEqual(selection.range, { from: '2026-09-01', to: '2026-09-30' }); assert.equal(selection.error, null); selection.select('Week'); selection = render(); assert.deepEqual(selection.range, { from: '2026-10-12', to: '2026-10-15' });
});

test('native calendar selection emits the chosen calendar date', () => { let chosen; const runtime = mobileRuntime({ react: { ...React, useState: () => [true, () => {}] } }); const output = runtime.render(runtime.load('src/components/DatePicker.tsx').DatePicker, { value: '2026-10-15', onChange: value => { chosen = value; } }); const picker = output.controls.find(c => c.nativeType === 'DateTimePicker'); picker.onChange({ type: 'set' }, new Date(2026, 10, 3, 12)); assert.equal(chosen, '2026-11-03'); picker.onChange({ type: 'dismissed' }, new Date(2027, 0, 1)); assert.equal(chosen, '2026-11-03'); });

test('QueryState separates failure, stale data, loading and empty; Retry calls the query', () => { const runtime = mobileRuntime(); const { QueryState } = runtime.load('src/components/QueryState.tsx'); assert.equal(runtime.render(QueryState, { query: ready([{}]), label: 'appointments' }).markup, ''); let retries = 0; let output = runtime.render(QueryState, { query: { ...failed, refetch() { retries++; } }, label: 'appointments', empty: 'No appointments today.' }); assert.match(output.markup, /Unable to load appointments/); assert.doesNotMatch(output.markup, /No appointments today/); output.controls.find(c => c.label === 'Retry appointments').onPress(); assert.equal(retries, 1); output = runtime.render(QueryState, { query: { ...failed, data: [] }, label: 'appointments' }); assert.match(output.markup, /out of date/); output = runtime.render(QueryState, { query: ready([]), label: 'appointments', empty: 'No appointments today.' }); assert.match(output.markup, /No appointments today/); output = runtime.render(QueryState, { query: { isFetching: true, refetch() {} }, label: 'appointments', empty: 'No appointments today.' }); assert.ok(output.controls.find(c => c.label === 'Loading appointments')); assert.doesNotMatch(output.markup, /No appointments today/); });

test('Reports retain detailed custom range controls while Dashboard uses only quick periods', () => { const api = { useClinicTimeQuery: () => ready(baseline), useGetAppointmentReportQuery: () => ready({ total_appointments: 0 }), useGetPatientReportQuery: () => failed, useGetFollowUpReportQuery: () => failed, useGetPaymentReportQuery: () => failed, useGetOwnerDashboardQuery: () => ready({ appointments: 0, completed: 0, cancelled: 0, no_show: 0, new_patients: 0, returning_patient_visits: 0, followup_appointments: 0, unique_patients: 0, confirmed_revenue: 0, cash: 0, upi: 0, pending_amount: 0 }) }; const reportRuntime = mobileRuntime({ '@/api/api': api }); const reports = reportRuntime.render(reportRuntime.load('app/doctor/reports/index.tsx').default); assert.match(reports.markup, /15 Oct 2026/); assert.match(reports.markup, /No appointments recorded/); assert.match(reports.markup, /Custom range/); const dashRuntime = mobileRuntime({ '@/api/api': api }); const dashboard = dashRuntime.render(dashRuntime.load('app/doctor/dashboard.tsx').default); assert.match(dashboard.markup, /This week/); assert.match(dashboard.markup, /This month/); assert.doesNotMatch(dashboard.markup, /Custom range/); });

test('patient history is explicitly a limited set of real completed visits, not a fabricated timeline', () => { const runtime = mobileRuntime({ '@/api/api': { useGetPatientOperationalSummaryQuery: () => ready({ patient: { full_name: 'Asha', gender: 'FEMALE', mobile_number: '+919876543210' }, total_completed_visits: 35, visit_history: [{ visit_id: 'v1', date: '2026-10-15', appointment_type: 'REGULAR', payment_status: 'CONFIRMED', followup_status: 'OPEN' }] }) } }); const output = runtime.render(runtime.load('app/doctor/patients/[patientId].tsx').default); assert.match(output.markup, /Recent Completed Visits/); assert.match(output.markup, /Showing 1 of 35/); assert.match(output.markup, /CONFIRMED/); assert.doesNotMatch(output.markup, /Coming soon|Diagnosis|Prescription/); });

test('Settings has a compact truthful heading and exposes supported groups', () => { const runtime = mobileRuntime({ '@/api/api': { useMeQuery: () => ready({ roles: ['OWNER_ADMIN'], display_name: 'Owner' }), useListDoctorsQuery: () => ready([{ display_name: 'Dr. Rao' }]), useLogoutMutation: () => [() => {}, {}] }, '@/store/store': { resetApiCache() {} }, 'expo-router': { useRouter: () => ({}), useNavigation: () => ({ addListener: () => () => {} }) } }); const output = runtime.render(runtime.load('app/doctor/more/index.tsx').default); assert.match(output.markup, /Settings/); assert.match(output.markup, /Clinic &amp; Practice/); assert.match(output.markup, /Administration/); assert.doesNotMatch(output.markup, /Good morning|Good evening|API:/); assert.equal(output.controls.filter(c => c.nativeType === 'ScrollView').length, 1); assert.ok(output.controls.some(c => c.accessibilityState?.expanded === false)); });

test('Doctor and Assistant tab labels retain their role-specific navigation', () => { const tabs = []; let roles = ['OWNER_ADMIN']; const Tabs = props => props.children; Tabs.Screen = props => { tabs.push(props); return null; }; const runtime = mobileRuntime({ 'expo-router': { Tabs, Redirect: () => null }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) }, '@/navigation/tabOptions': { getSharedTabScreenOptions: () => ({}), TabIcon: props => React.createElement('span', null, props.name) }, '@/api/api': { useMeQuery: () => ready({ roles }) } }); runtime.render(runtime.load('app/doctor/_layout.tsx').default); assert.deepEqual(tabs.map(t => t.options.title), ['Today', 'Patients', 'Dashboard', 'Reports', 'Settings']); const settings = tabs.find(t => t.name === 'more'); assert.equal(settings.options.tabBarIcon({}).props.name, 'settings'); tabs.length = 0; roles = ['ASSISTANT']; runtime.render(runtime.load('app/assistant/_layout.tsx').default); assert.deepEqual(tabs.filter(t => t.options.href !== null).map(t => t.options.title), ['Home', 'Appointments', 'Patients', 'Follow-ups', 'More']); assert.equal(tabs.find(t => t.name === 'appointments').options.tabBarLabel, 'Appointments'); });

test('schedule exception network failure is not presented as no blocked dates', () => { const runtime = mobileRuntime({ '@/api/api': { useClinicTimeQuery: () => ready(baseline), useListDoctorsQuery: () => ready([{ doctor_id: 'd1' }]), useListScheduleExceptionsQuery: () => failed, useUnblockScheduleExceptionsMutation: () => [() => {}, {}] } }); const output = runtime.render(runtime.load('app/doctor/more/schedule/exceptions/index.tsx').default); assert.match(output.markup, /Unable to load exceptions/); assert.doesNotMatch(output.markup, /No Upcoming Exceptions|No dates or sessions are currently blocked/); });

test('appointment list network failure offers Retry and does not claim an empty day', () => { const runtime = mobileRuntime({ '@/api/api': { useClinicTimeQuery: () => ready(baseline), useListAppointmentsQuery: () => failed }, 'expo-router': { useRouter: () => ({}), useNavigation: () => ({ getParent: () => undefined }) } }); const output = runtime.render(runtime.load('app/assistant/appointments/index.tsx').default); assert.match(output.markup, /Unable to load appointments/); assert.doesNotMatch(output.markup, /No appointments found/); assert.ok(output.controls.find(c => c.label === 'Retry appointments')); });
