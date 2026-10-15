const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileRuntime } = require('./helpers/loadMobile');

const runtime = mobileRuntime();
const { createWeeklyEditor, defaultSession, initialDraft, validateDraft, daySummary } = runtime.load('src/features/scheduling/weeklyEditor.ts');
const { WeeklyScheduleEditor } = runtime.load('src/features/scheduling/WeeklyScheduleEditor.tsx');
const { ScheduleReview } = runtime.load('src/features/scheduling/ScheduleReview.tsx');
const overview = { doctor_id: 'doctor', effective_on: '2026-10-15', days: Array.from({ length: 7 }, (_, weekday) => ({
  weekday, weekday_name: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][weekday], current: null, upcoming: null,
})) };
const previewResult = { proposal_token: 'signed-secret-token', evaluated_at: '2026-10-15T09:00:00Z', impacts: [
  { weekday: 0, weekday_name: 'Monday', applies_from: '2026-10-19', reason: 'Applies from 19 Oct 2026.', conflict_detected: false, existing_appointments_count: 0, conflict_metadata: null },
  { weekday: 4, weekday_name: 'Friday', applies_from: '2026-10-30', reason: 'Existing appointments require a later date.', conflict_detected: true, existing_appointments_count: 2, conflict_metadata: { conflicting_date: '2026-10-23' } },
] };
function setup(services = {}) {
  const calls = { preview: [], apply: [], success: 0 };
  const editor = createWeeklyEditor(initialDraft(overview), {
    preview: async body => { calls.preview.push(body); return previewResult; },
    apply: async body => { calls.apply.push(body); return overview; },
    onApplied: () => { calls.success++; }, ...services,
  });
  const render = () => runtime.render(WeeklyScheduleEditor, { editor, overview, loadedFrom: 'Monday current hours', onBack() {} });
  const press = label => {
    const control = render().controls.find(item => item.nativeType === 'Pressable' && item.label === label);
    assert.ok(control, `Rendered control ${label}`);
    assert.ok(!control.disabled, `${label} enabled`);
    control.onPress();
  };
  return { editor, calls, render, press };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const failure = code => ({ status: 409, data: { error: { code, message: 'internal details not for display' } } });

test('editor renders real shared keyboard container and registered editable inputs', () => {
  const { render, calls } = setup();
  const { markup, controls } = render();
  assert.match(markup, /Edit weekly hours/);
  assert.equal(controls.filter(c => c.nativeType === 'ScrollView').length, 1);
  const inputs = controls.filter(c => c.nativeType === 'TextInput');
  assert.equal(inputs.length, 3);
  assert.ok(inputs.every(input => typeof input.onFocus === 'function' && typeof input.onSelectionChange === 'function'));
  assert.deepEqual(calls.preview, []);
  assert.deepEqual(calls.apply, []);
});

test('weekday controls select multiple days and can remove the last selected day', async () => {
  const { editor, press } = setup();
  press('Wednesday'); press('Friday');
  assert.deepEqual(editor.getSnapshot().draft.weekdays, [0, 2, 4]);
  press('Monday'); press('Wednesday'); press('Friday');
  await editor.preview();
  assert.match(editor.getSnapshot().errors.weekdays, /at least one/);
});

test('rapid weekday taps use current state and selection is exposed accessibly', () => {
  const { editor, render } = setup();
  const wednesday = render().controls.find(c => c.nativeType === 'Pressable' && c.label === 'Wednesday');
  wednesday.onPress(); wednesday.onPress();
  assert.deepEqual(editor.getSnapshot().draft.weekdays, [0]);
  assert.equal(render().controls.find(c => c.label === 'Monday').accessibilityState.checked, true);
});

test('editor route loads the requested future day off without making mutation calls', () => {
  const planned = structuredClone(overview);
  planned.days[4].upcoming = { active: false, effective_from: '2026-10-30', sessions: [] };
  let mutations = 0;
  const routeRuntime = mobileRuntime({
    'expo-router': { useLocalSearchParams: () => ({ weekday: '4', doctorId: 'doctor' }), useRouter: () => ({ back() {} }) },
    '@/api/api': {
      useListDoctorsQuery: () => ({ data: [{ doctor_id: 'doctor' }] }),
      useGetScheduleOverviewQuery: () => ({ data: planned }),
      usePreviewScheduleImpactMutation: () => [() => { mutations++; }],
      useSmartApplyScheduleMutation: () => [() => { mutations++; }],
    },
  });
  const { default: Screen } = routeRuntime.load('app/doctor/more/schedule/weekly/edit.tsx');
  const { markup, controls } = routeRuntime.render(Screen);
  assert.match(markup, /Planned day off from 30 Oct 2026/);
  assert.equal(controls.find(c => c.label === 'Friday').accessibilityState.checked, true);
  assert.equal(controls.filter(c => c.nativeType === 'TextInput').length, 0);
  assert.equal(mutations, 0);
});

test('weekly summary displays planned day off and offers general and weekday editor entry', () => {
  const planned = structuredClone(overview);
  planned.days[4].upcoming = { active: false, effective_from: '2026-10-30', sessions: [] };
  const routes = [];
  const routeRuntime = mobileRuntime({
    'expo-router': { useLocalSearchParams: () => ({ saved: '1' }), useRouter: () => ({ back() {}, push: route => routes.push(route) }) },
    '@/api/api': {
      useListDoctorsQuery: () => ({ data: [{ doctor_id: 'doctor', display_name: 'Doctor' }] }),
      useGetScheduleOverviewQuery: () => ({ data: planned }),
    },
  });
  const { default: Screen } = routeRuntime.load('app/doctor/more/schedule/weekly/index.tsx');
  const { markup, controls } = routeRuntime.render(Screen);
  assert.match(markup, /Planned day off from 30 Oct 2026/);
  assert.match(markup, /Weekly schedule updated/);
  for (const label of ['Edit weekly schedule', 'Edit Friday']) {
    controls.find(c => c.nativeType === 'Pressable' && c.label === label).onPress();
  }
  assert.equal(routes[0].pathname, '/doctor/more/schedule/weekly/edit');
  assert.equal(routes[0].params.weekday, undefined);
  assert.equal(routes[1].params.weekday, '4');
});

test('review hardware back returns to editing but cannot close an in-flight apply', async () => {
  const { editor } = setup();
  await editor.preview();
  let edits = 0;
  for (const applying of [false, true]) {
    const { controls } = runtime.render(ScheduleReview, { review: editor.getSnapshot().review, applying, onEdit: () => { edits++; }, onApply() {} });
    controls.find(c => c.nativeType === 'Modal').onRequestClose();
  }
  assert.equal(edits, 1);
});

test('day off sends no sessions; switching back preserves edited working hours', async () => {
  const { editor, calls, press, render } = setup();
  const input = render().controls.find(c => c.accessibilityLabel === 'Session 1 name');
  input.onChangeText('Evening clinic');
  press('Day off');
  assert.equal(render().controls.filter(c => c.nativeType === 'TextInput').length, 0);
  await editor.preview();
  assert.deepEqual(calls.preview[0].sessions, []);
  editor.edit(editor.getSnapshot().draft);
  press('Working day');
  assert.equal(editor.getSnapshot().draft.sessions[0].name, 'Evening clinic');
});

test('add, reorder and remove session controls update the eventual payload', () => {
  const { editor, press, render } = setup();
  press('Add session');
  assert.equal(editor.getSnapshot().draft.sessions.length, 2);
  const second = editor.getSnapshot().draft.sessions[1];
  assert.equal(second.start, '12:00');
  const moveUp = render().controls.filter(c => c.label === 'Move up' && c.nativeType === 'Pressable' && !c.disabled)[0];
  moveUp.onPress();
  const proposal = validateDraft(editor.getSnapshot().draft).proposal;
  assert.equal(proposal.sessions[0].start_time, '12:00');
  assert.deepEqual(proposal.sessions.map(s => s.display_order), [0, 1]);
  press('Remove session 1'); press('Remove session 1');
  assert.match(validateDraft(editor.getSnapshot().draft).errors.sessions, /at least one/);
});

for (const [field, value] of [['name', ' '], ['start', '25:00'], ['end', '09:00'], ['interval', '0'], ['interval', '241'], ['interval', '1.5'], ['capacity', '0'], ['capacity', '501'], ['capacity', '13']]) {
  test(`validation rejects ${field}=${JSON.stringify(value)} before network`, async () => {
    const { editor, calls } = setup();
    editor.edit({ ...editor.getSnapshot().draft, sessions: [{ ...defaultSession('a'), [field]: value }] });
    await editor.preview();
    assert.ok(editor.getSnapshot().errors['a.' + field]);
    assert.equal(calls.preview.length, 0);
  });
}

test('overlap is rejected while touching session boundaries are allowed', () => {
  const draft = initialDraft(overview);
  draft.sessions.push(defaultSession('second'));
  assert.ok(validateDraft(draft).errors['second.start']);
  draft.sessions[1] = { ...draft.sessions[1], start: '12:00', end: '15:00' };
  assert.deepEqual(validateDraft(draft).errors, {});
});

test('route weekday initializes upcoming off-day before current working content', () => {
  const state = structuredClone(overview);
  state.days[4].current = { active: true, sessions: [{ active: true }] };
  state.days[4].upcoming = { active: false, effective_from: '2026-10-30', sessions: [] };
  const draft = initialDraft(state, '4');
  assert.deepEqual(draft.weekdays, [4]);
  assert.equal(draft.working, false);
  assert.deepEqual(validateDraft(draft).proposal.sessions, []);
  assert.match(daySummary(state.days[4]), /Currently working.*Planned day off from 30 Oct 2026/);
  assert.deepEqual(initialDraft(state, 'invalid').weekdays, [0]);
});

test('loaded sessions retain content, full time precision and stored ordering', () => {
  const state = structuredClone(overview);
  const session = { session_definition_id: 's', session_name: 'Loaded', start_time: '09:00:01.123456', end_time: '12:00:01.123456', slot_interval_minutes: 20, maximum_capacity: 8, active: true, display_order: 5 };
  state.days[0].current = { active: true, sessions: [session] };
  const result = validateDraft(initialDraft(state));
  assert.deepEqual(result.errors, {});
  assert.equal(result.proposal.sessions[0].start_time, session.start_time);
  assert.equal(result.proposal.sessions[0].maximum_capacity, 8);
});

test('preview payload is exact contract and review shows different per-day safe dates without token', async () => {
  const { editor, calls, press } = setup();
  press('Friday'); await editor.preview();
  assert.deepEqual(calls.preview[0], { weekdays: [0, 4], sessions: [{ session_name: 'Clinic session', start_time: '09:00', end_time: '12:00', slot_interval_minutes: 15, maximum_capacity: 12, active: true, display_order: 0 }] });
  const { markup } = runtime.render(ScheduleReview, { review: editor.getSnapshot().review, applying: false, onEdit() {}, onApply() {} });
  assert.match(markup, /Monday.*19 Oct 2026/);
  assert.match(markup, /Friday.*30 Oct 2026/);
  assert.match(markup, /Deferred to a safe date/);
  assert.match(markup, /23 Oct 2026/);
  assert.ok(!markup.includes('signed-secret-token'));
  assert.equal(calls.apply.length, 0);
});

test('editing invalidates review and prohibits applying its old token', async () => {
  const { editor, calls } = setup();
  await editor.preview();
  editor.edit({ ...editor.getSnapshot().draft, weekdays: [2] });
  await editor.apply();
  assert.equal(editor.getSnapshot().review, null);
  assert.equal(calls.apply.length, 0);
});

test('late preview response cannot authorize a form edited while the request was pending', async () => {
  const wait = deferred();
  const { editor } = setup({ preview: () => wait.promise });
  const pending = editor.preview();
  editor.edit({ ...editor.getSnapshot().draft, working: false });
  wait.resolve(previewResult); await pending;
  assert.equal(editor.getSnapshot().review, null);
  assert.equal(editor.getSnapshot().phase, 'editing');
});

test('apply uses reviewed payload/token once, prevents duplicate taps, clears state on success', async () => {
  const wait = deferred(); let calls = 0; let submitted;
  const { editor, calls: results } = setup({ apply: body => { calls++; submitted = body; return wait.promise; } });
  await editor.preview();
  const snapshot = editor.getSnapshot().review;
  const pending = editor.apply(); await editor.apply();
  assert.equal(calls, 1);
  assert.deepEqual(submitted, { ...snapshot.payload, proposal_token: previewResult.proposal_token });
  editor.edit({ ...editor.getSnapshot().draft, working: false });
  assert.equal(editor.getSnapshot().draft.working, true);
  wait.resolve(overview); await pending;
  assert.equal(results.success, 1);
  assert.equal(editor.getSnapshot().phase, 'saved');
  assert.equal(editor.getSnapshot().review, null);
});

test('stale preview preserves edits, discards token and requires another preview', async () => {
  const { editor, calls } = setup({ apply: async () => { throw failure('STALE_SCHEDULE_PREVIEW'); } });
  await editor.preview(); const draft = editor.getSnapshot().draft;
  await editor.apply();
  assert.equal(editor.getSnapshot().draft, draft);
  assert.equal(editor.getSnapshot().review, null);
  assert.match(editor.getSnapshot().message, /Preview the changes again/);
  assert.ok(!editor.getSnapshot().message.includes('internal details'));
  await editor.preview();
  assert.equal(calls.preview.length, 2);
});

for (const [code, message] of [['UNRESOLVABLE_APPOINTMENT_CONFLICT', /cannot currently be applied/], ['SCHEDULE_OCCUPANCY_CONFLICT', /cannot be safely matched/], ['PERMISSION_DENIED', /permission/], ['VALIDATION_ERROR', /capacities/]]) {
  test(`${code} has intentional operational feedback`, async () => {
    const { editor, render } = setup({ preview: async () => { throw failure(code); } });
    await editor.preview();
    assert.match(render().markup, message);
    assert.equal(editor.getSnapshot().review, null);
  });
}

test('uncertain apply result drops the token and asks user to check saved state', async () => {
  const { editor } = setup({ apply: async () => { throw { status: 'FETCH_ERROR' }; } });
  await editor.preview(); await editor.apply();
  assert.match(editor.getSnapshot().message, /may have been saved/);
  assert.equal(editor.getSnapshot().review, null);
});

test('real RTK Query sends preview/apply contracts and invalidates subscribed overview after success', async () => {
  const { configureStore } = require('@reduxjs/toolkit');
  const apiRuntime = mobileRuntime();
  const { api } = apiRuntime.load('src/api/api.ts');
  const previousFetch = global.fetch;
  const requests = [];
  let applied = false;
  global.fetch = async request => {
    requests.push({ url: request.url, method: request.method, body: request.method === 'GET' ? null : await request.json() });
    if (request.url.endsWith('/preview-impact')) return Response.json(previewResult);
    if (request.url.endsWith('/smart-apply')) applied = true;
    return Response.json({ ...overview, effective_on: applied ? '2026-10-16' : overview.effective_on });
  };
  const store = configureStore({ reducer: { [api.reducerPath]: api.reducer }, middleware: get => get().concat(api.middleware) });
  try {
    await store.dispatch(api.endpoints.getScheduleOverview.initiate('doctor')).unwrap();
    const body = validateDraft(initialDraft(overview)).proposal;
    const result = await store.dispatch(api.endpoints.previewScheduleImpact.initiate({ doctorId: 'doctor', body })).unwrap();
    await store.dispatch(api.endpoints.smartApplySchedule.initiate({ doctorId: 'doctor', body: { ...body, proposal_token: result.proposal_token } })).unwrap();
    await store.dispatch(api.util.getRunningQueryThunk('getScheduleOverview', 'doctor'));
    assert.equal(api.endpoints.getScheduleOverview.select('doctor')(store.getState()).data.effective_on, '2026-10-16');
    assert.equal(requests.filter(r => r.url.endsWith('/overview')).length, 2);
    assert.equal(requests.find(r => r.url.endsWith('/preview-impact')).method, 'POST');
    assert.equal(requests.find(r => r.url.endsWith('/smart-apply')).method, 'PUT');
    assert.deepEqual(requests.find(r => r.url.endsWith('/smart-apply')).body, { ...body, proposal_token: result.proposal_token });
  } finally {
    store.dispatch(api.util.resetApiState());
    global.fetch = previousFetch;
  }
});
