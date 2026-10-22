const test = require('node:test');
const assert = require('node:assert/strict');
const { configureStore } = require('@reduxjs/toolkit');
const { mobileRuntime } = require('./helpers/loadMobile');

const followup = n => ({ followup_id: `f${n}`, patient: { full_name: `Patient-${n}`, patient_code: `PT-${n}` },
  status: 'OPEN', due_date: '2026-10-15', source_visit_date: '2026-10-01', linked_appointment: null, overdue: false });
const reminder = n => ({ reminder_id: `r${n}`, patient_name: `Patient-${n}`, followup_id: `f${n}`,
  status: 'DUE', due_on: '2026-10-15', language: 'EN', reminder_type: 'FOLLOWUP_REMINDER', sendable: true });

function harness(t, count = 55) {
  const runtime = mobileRuntime();
  const { api } = runtime.load('src/api/api.ts');
  const { worklistItems } = runtime.load('src/api/worklists.ts');
  const store = configureStore({ reducer: { [api.reducerPath]: api.reducer }, middleware: get => get().concat(api.middleware) });
  const server = { followups: Array.from({ length: count }, (_, n) => followup(n + 1)),
    reminders: Array.from({ length: count }, (_, n) => reminder(n + 1)), failOffset: null, requests: [], mutate: () => ({}) };
  const previousFetch = global.fetch;
  global.fetch = async request => {
    const url = new URL(request.url), path = url.pathname;
    server.requests.push({ path, method: request.method, offset: Number(url.searchParams.get('offset')), search: url.search });
    if (request.method !== 'GET') {
      if (server.mutationGate) { server.mutationGate.started(); await server.mutationGate.wait; }
      return Response.json(server.mutate(path));
    }
    if (/\/followups\/f\d+$/.test(path)) return Response.json(server.followups.find(f => path.endsWith('/' + f.followup_id)));
    const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 50);
    if (offset === server.failOffset) return Response.json({ error: { message: 'Network failure' } }, { status: 503 });
    let rows = path.endsWith('/followups') ? server.followups : server.reminders;
    const state = url.searchParams.get('state'), status = url.searchParams.get('status'), id = url.searchParams.get('followup_id');
    if (state) rows = rows.filter(f => state === 'DUE_TODAY' ? f.status === 'OPEN' : f.status === state);
    if (status) rows = rows.filter(r => r.status === status);
    if (id) rows = rows.filter(r => r.followup_id === id);
    const response = Response.json({ items: rows.slice(offset, offset + limit), total: rows.length, offset, limit });
    if (server.pageGate && offset === (server.pageGate.offset ?? 50)) { server.pageGate.started(); await server.pageGate.wait; }
    return response;
  };
  t.after(() => { store.dispatch(api.util.resetApiState()); global.fetch = previousFetch; });
  const args = { followUpWorklist: { state: 'DUE_TODAY' }, reminderWorklist: { status: 'DUE', dueThrough: '2026-10-15' } };
  const dispatch = (name, arg, options) => store.dispatch(api.endpoints[name].initiate(arg, options));
  const state = (name, arg) => api.endpoints[name].select(arg)(store.getState());
  const settle = async () => {
    // Include lifecycle-triggered refetches, which may start after the original
    // running-query promise resolves. Observe reducer state, not just that promise.
    for (let i = 0; i < 100; i++) {
      await Promise.all(store.dispatch(api.util.getRunningQueriesThunk()));
      await new Promise(resolve => setImmediate(resolve));
      const queries = Object.values(store.getState()[api.reducerPath].queries);
      if (queries.every(q => q.status !== 'pending')) return;
    }
    assert.fail('Worklist requests did not settle');
  };
  const query = (name, arg) => {
    const selected = state(name, arg);
    return { ...selected, currentData: selected.data, isFetching: selected.isLoading,
      fetchNextPage: () => dispatch(name, arg, { direction: 'forward', subscribe: false }),
      refetch: () => dispatch(name, arg, { forceRefetch: true, subscribe: false }),
    };
  };
  const views = mobileRuntime({
    '@/api/api': {
      useFollowUpWorklistInfiniteQuery: arg => query('followUpWorklist', arg),
      useReminderWorklistInfiniteQuery: arg => query('reminderWorklist', arg),
      useClinicTimeQuery: () => ({ data: { clinic_date: '2026-10-15' } }),
      useSkipReminderMutation: () => [() => {}, {}],
      useGetFollowUpQuery: id => state('getFollowUp', id),
      useListRemindersQuery: arg => state('listReminders', arg),
      useCloseFollowUpMutation: () => [() => {}, {}],
    },
    'expo-router': {
      useRouter: () => ({ push() {}, back() {}, replace() {} }),
      useLocalSearchParams: () => ({ followupId: 'f1' }),
      useFocusEffect: () => {},
    },
  });
  const screens = { followUpWorklist: views.load('app/assistant/followups/index.tsx').default,
    reminderWorklist: views.load('app/assistant/reminders/index.tsx').default,
    detail: views.load('app/assistant/followups/[followupId].tsx').default };
  const render = name => views.render(screens[name]);
  const press = (name, label) => {
    const control = render(name).controls.find(c => c.nativeType === 'Pressable' && c.label === label);
    assert.ok(control, `Visible ${label}`); assert.ok(!control.disabled); control.onPress();
  };
  const items = name => worklistItems(state(name, args[name]).data, row => row.followup_id ?? row.reminder_id);
  return { api, store, server, dispatch, state, settle, args, render, press, items, query };
}

for (const name of ['followUpWorklist', 'reminderWorklist']) {
  test(`${name}: rendered Load more reaches record 55, preserves records, and stops at end`, async t => {
    const h = harness(t);
    await h.dispatch(name, h.args[name]).unwrap();
    assert.equal(h.items(name).length, 50);
    assert.doesNotMatch(h.render(name).markup, /Patient-55/);
    h.press(name, 'Load more'); await h.settle();
    assert.match(h.render(name).markup, /Patient-55/);
    assert.equal(h.items(name).length, 55);
    assert.equal(new Set(h.items(name).map(i => i.followup_id ?? i.reminder_id)).size, 55);
    assert.ok(h.server.requests.some(r => r.offset === 50));
    assert.ok(!h.render(name).controls.some(c => c.label === 'Load more'));
    const requests = h.server.requests.length;
    await h.dispatch(name, h.args[name], { direction: 'forward', subscribe: false });
    assert.equal(h.server.requests.length, requests);
  });

  test(`${name}: page two failure keeps rendered page one and Retry succeeds`, async t => {
    const h = harness(t);
    await h.dispatch(name, h.args[name]); h.server.failOffset = 50;
    h.press(name, 'Load more'); await h.settle();
    assert.match(h.render(name).markup, /Patient-1/);
    assert.match(h.render(name).markup, /Unable to load more/);
    assert.equal(h.items(name).length, 50);
    h.server.failOffset = null; h.press(name, 'Retry'); await h.settle();
    assert.match(h.render(name).markup, /Patient-55/);
  });

  test(`${name}: in-flight next page retains existing rows and disables duplicate requests`, async t => {
    const h = harness(t);
    await h.dispatch(name, h.args[name]);
    let release, began;
    const started = new Promise(resolve => { began = resolve; });
    h.server.pageGate = { started: began, wait: new Promise(resolve => { release = resolve; }) };
    try {
      h.press(name, 'Load more'); await started;
      const output = h.render(name);
      assert.match(output.markup, /Patient-50/);
      assert.ok(output.controls.find(c => c.label === 'Load more').disabled);
    } finally { release(); await h.settle(); }
    assert.match(h.render(name).markup, /Patient-55/);
  });

  test(`${name}: first-page failure is not an empty state; refresh resets loaded pages`, async t => {
    const h = harness(t); h.server.failOffset = 0;
    await h.dispatch(name, h.args[name]);
    const output = h.render(name).markup;
    assert.match(output, /Unable to load records/);
    assert.doesNotMatch(output, /Nothing here|All reminders are handled/);
    h.server.failOffset = null; h.press(name, 'Retry'); await h.settle();
    h.press(name, 'Load more'); await h.settle();
    const refresh = h.render(name).controls.find(c => c.nativeType === 'ScrollView').refreshControl;
    refresh.props.onRefresh(); await h.settle();
    assert.equal(h.state(name, h.args[name]).data.pages.length, 1);
    assert.equal(h.items(name).length, 50);
    h.press(name, 'Load more'); await h.settle();
    assert.equal(h.items(name).length, 55);
  });

  test(`${name}: filter changes start at zero and do not mix cached records`, async t => {
    const h = harness(t);
    await h.dispatch(name, h.args[name]);
    await h.dispatch(name, h.args[name], { direction: 'forward', subscribe: false });
    const changed = name === 'followUpWorklist' ? { state: 'BOOKED' } : { status: 'SENT', dueThrough: '2026-10-16' };
    await h.dispatch(name, changed);
    assert.deepEqual(h.state(name, changed).data.pageParams, [0]);
    assert.deepEqual(h.state(name, changed).data.pages[0].items, []);
    assert.equal(h.server.requests.at(-1).offset, 0);
    await h.dispatch(name, h.args[name], { forceRefetch: true, subscribe: false });
    assert.deepEqual(h.state(name, h.args[name]).data.pageParams, [0]);
  });

  test(`${name}: failed mutation refetch labels retained pages stale; Retry discards them`, async t => {
    const h = harness(t);
    await h.dispatch(name, h.args[name]);
    await h.dispatch(name, h.args[name], { direction: 'forward', subscribe: false });
    h.server.failOffset = 0;
    await h.dispatch('closeFollowUp', { followupId: 'f1', reason: 'CONTACTED' });
    await h.settle();
    assert.match(h.render(name).markup, /Shown records may be out of date/);
    assert.match(h.render(name).markup, /Patient-55/);
    h.server.failOffset = null;
    h.press(name, 'Retry'); await h.settle();
    assert.deepEqual(h.state(name, h.args[name]).data.pageParams, [0]);
    h.press(name, 'Load more'); await h.settle();
    assert.match(h.render(name).markup, /Patient-55/);
  });
}

test('duplicate IDs crossing an offset boundary render only once', () => {
  const { worklistItems } = mobileRuntime().load('src/api/worklists.ts');
  assert.deepEqual(worklistItems({ pages: [{ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'c' }] }] }, x => x.id),
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
});

test('a mutation during page loading cannot attach a late stale tail after invalidation', async t => {
  const h = harness(t);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist);
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  h.server.pageGate = { started: began, wait: new Promise(resolve => { release = resolve; }) };
  try {
    h.press('followUpWorklist', 'Load more'); await started;
    h.server.mutate = () => { h.server.followups[54].status = 'CLOSED'; return {}; };
    await h.dispatch('closeFollowUp', { followupId: 'f55', reason: 'CONTACTED' });
  } finally { release(); await h.settle(); }
  assert.deepEqual(h.state('followUpWorklist', h.args.followUpWorklist).data.pageParams, [0]);
  assert.doesNotMatch(h.render('followUpWorklist').markup, /Patient-55/);
});

test('a first page started during a mutation is reconciled even before its tags exist', async t => {
  const h = harness(t);
  let releaseMutation, releasePage, mutationBegan, pageBegan;
  const mutationStarted = new Promise(resolve => { mutationBegan = resolve; });
  const pageStarted = new Promise(resolve => { pageBegan = resolve; });
  h.server.mutationGate = { started: mutationBegan, wait: new Promise(resolve => { releaseMutation = resolve; }) };
  h.server.pageGate = { offset: 0, started: pageBegan, wait: new Promise(resolve => { releasePage = resolve; }) };
  h.server.mutate = () => { h.server.followups[0].status = 'CLOSED'; return {}; };
  const mutation = h.dispatch('closeFollowUp', { followupId: 'f1', reason: 'CONTACTED' });
  try {
    await mutationStarted;
    h.dispatch('followUpWorklist', h.args.followUpWorklist);
    await pageStarted;
    releaseMutation(); await mutation;
  } finally { releaseMutation(); releasePage(); await h.settle(); }
  // The first read could have observed pre-write state; a fresh read is required.
  assert.ok(h.server.requests.filter(r => r.path.endsWith('/followups') && r.method === 'GET').length >= 2);
  assert.equal(h.items('followUpWorklist')[0]?.followup_id, 'f2');
});

test('real RTK invalidation: bookFollowUp refreshes affected lists/details and discards appended pages', async t => {
  const h = harness(t);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist, { direction: 'forward', subscribe: false });
  await h.dispatch('getFollowUp', 'f1');
  h.server.mutate = () => {
    const f = h.server.followups[0];
    f.status = 'BOOKED';
    f.linked_appointment = { appointment_id: 'a1', date: '2026-10-16', time: '09:00:00' };
    return f;
  };
  await h.dispatch('bookFollowUp', { followupId: 'f1', body: { appointment_id: 'a1' } }); await h.settle();
  assert.deepEqual(h.state('followUpWorklist', h.args.followUpWorklist).data.pageParams, [0]);
  assert.equal(h.state('getFollowUp', 'f1').data.status, 'BOOKED');
});

test('real RTK invalidation: closeFollowUp refreshes affected lists/details and discards appended pages', async t => {
  const h = harness(t);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist, { direction: 'forward', subscribe: false });
  await h.dispatch('getFollowUp', 'f1');
  h.server.mutate = () => { h.server.followups[0].status = 'CLOSED'; return h.server.followups[0]; };
  await h.dispatch('closeFollowUp', { followupId: 'f1', reason: 'CONTACTED' }); await h.settle();
  assert.deepEqual(h.state('followUpWorklist', h.args.followUpWorklist).data.pageParams, [0]);
  assert.equal(h.state('getFollowUp', 'f1').data.status, 'CLOSED');
});

test('real RTK invalidation: cancelAppointment refreshes affected lists/details and discards appended pages', async t => {
  const h = harness(t);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist, { direction: 'forward', subscribe: false });
  h.server.mutate = () => ({});
  await h.dispatch('cancelAppointment', { appointmentId: 'a1', body: { reason: 'PATIENT_CANCELLED' } }); await h.settle();
  assert.deepEqual(h.state('followUpWorklist', h.args.followUpWorklist).data.pageParams, [0]);
});

test('real RTK invalidation: rescheduleAppointment refreshes affected lists/details and discards appended pages', async t => {
  const h = harness(t);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist, { direction: 'forward', subscribe: false });
  h.server.mutate = () => ({});
  await h.dispatch('rescheduleAppointment', { appointmentId: 'a1', body: { date: '2026-10-20', time: '10:00:00' } }); await h.settle();
  assert.deepEqual(h.state('followUpWorklist', h.args.followUpWorklist).data.pageParams, [0]);
});

test('real RTK invalidation: completeVisit refreshes affected lists/details and discards appended pages', async t => {
  const h = harness(t);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist);
  await h.dispatch('followUpWorklist', h.args.followUpWorklist, { direction: 'forward', subscribe: false });
  h.server.mutate = () => ({});
  await h.dispatch('completeVisit', { visitId: 'v1', body: { followup_required: false } }); await h.settle();
  assert.deepEqual(h.state('followUpWorklist', h.args.followUpWorklist).data.pageParams, [0]);
});

test('real RTK invalidation: markReminderSent refreshes affected lists/details and discards appended pages', async t => {
  const h = harness(t);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist, { direction: 'forward', subscribe: false });
  h.server.mutate = () => { h.server.reminders[0].status = 'SENT'; return h.server.reminders[0]; };
  await h.dispatch('markReminderSent', { reminderId: 'r1' }); await h.settle();
  assert.deepEqual(h.state('reminderWorklist', h.args.reminderWorklist).data.pageParams, [0]);
});

test('real RTK invalidation: skipReminder refreshes affected lists/details and discards appended pages', async t => {
  const h = harness(t);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist, { direction: 'forward', subscribe: false });
  h.server.mutate = () => { h.server.reminders[0].status = 'SKIPPED'; return h.server.reminders[0]; };
  await h.dispatch('skipReminder', { reminderId: 'r1', reason: 'done' }); await h.settle();
  assert.deepEqual(h.state('reminderWorklist', h.args.reminderWorklist).data.pageParams, [0]);
});

test('real RTK invalidation: prepareReminder refreshes affected lists/details and discards appended pages', async t => {
  const h = harness(t);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist, { direction: 'forward', subscribe: false });
  h.server.mutate = () => h.server.reminders[0];
  await h.dispatch('prepareReminder', { reminderId: 'r1' }); await h.settle();
  assert.deepEqual(h.state('reminderWorklist', h.args.reminderWorklist).data.pageParams, [0]);
});

test('mutation removes a page-two row from the active filter without retaining a stale tail', async t => {
  const h = harness(t);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist, { direction: 'forward', subscribe: false });
  h.server.mutate = () => { h.server.reminders[54].status = 'SENT'; return h.server.reminders[54]; };
  await h.dispatch('markReminderSent', { reminderId: 'r55' }); await h.settle();
  assert.deepEqual(h.state('reminderWorklist', h.args.reminderWorklist).data.pageParams, [0]);
  assert.doesNotMatch(h.render('reminderWorklist').markup, /Patient-55/);
});

test('createAppointment invalidates reminder eligibility/content', async t => {
  const h = harness(t, 5);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  const before = h.server.requests.filter(r => r.path.endsWith('/reminders')).length;
  h.server.mutate = () => ({});
  await h.dispatch('createAppointment', { body: {} }); await h.settle();
  assert.ok(h.server.requests.filter(r => r.path.endsWith('/reminders')).length > before);
});

test('checkInAppointment invalidates reminder eligibility/content', async t => {
  const h = harness(t, 5);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  const before = h.server.requests.filter(r => r.path.endsWith('/reminders')).length;
  h.server.mutate = () => ({});
  await h.dispatch('checkInAppointment', { appointmentId: 'a1' }); await h.settle();
  assert.ok(h.server.requests.filter(r => r.path.endsWith('/reminders')).length > before);
});

test('blockSession invalidates reminder eligibility/content', async t => {
  const h = harness(t, 5);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  const before = h.server.requests.filter(r => r.path.endsWith('/reminders')).length;
  h.server.mutate = () => ({});
  await h.dispatch('blockSession', { sessionOccurrenceId: 's1', reason: 'test' }); await h.settle();
  assert.ok(h.server.requests.filter(r => r.path.endsWith('/reminders')).length > before);
});

test('unblockSession invalidates reminder eligibility/content', async t => {
  const h = harness(t, 5);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  const before = h.server.requests.filter(r => r.path.endsWith('/reminders')).length;
  h.server.mutate = () => ({});
  await h.dispatch('unblockSession', { sessionOccurrenceId: 's1' }); await h.settle();
  assert.ok(h.server.requests.filter(r => r.path.endsWith('/reminders')).length > before);
});

test('blockScheduleException invalidates reminder eligibility/content', async t => {
  const h = harness(t, 5);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  const before = h.server.requests.filter(r => r.path.endsWith('/reminders')).length;
  h.server.mutate = () => ({});
  await h.dispatch('blockScheduleException', { doctorId: 'd1', body: {} }); await h.settle();
  assert.ok(h.server.requests.filter(r => r.path.endsWith('/reminders')).length > before);
});

test('unblockScheduleExceptions invalidates reminder eligibility/content', async t => {
  const h = harness(t, 5);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  const before = h.server.requests.filter(r => r.path.endsWith('/reminders')).length;
  h.server.mutate = () => ({});
  await h.dispatch('unblockScheduleExceptions', { doctorId: 'd1', date: '2026-10-20' }); await h.settle();
  assert.ok(h.server.requests.filter(r => r.path.endsWith('/reminders')).length > before);
});

test('createAppointmentMessage invalidates reminder eligibility/content', async t => {
  const h = harness(t, 5);
  await h.dispatch('reminderWorklist', h.args.reminderWorklist);
  const before = h.server.requests.filter(r => r.path.endsWith('/reminders')).length;
  h.server.mutate = () => ({});
  await h.dispatch('createAppointmentMessage', { appointmentId: 'a1', body: {} }); await h.settle();
  assert.ok(h.server.requests.filter(r => r.path.endsWith('/reminders')).length > before);
});

test('cancelAppointment: inactive detail cache is evicted and return loads the new state/link', async t => {
  const h = harness(t, 5);
  await h.dispatch('getFollowUp', 'f1', { subscribe: false });
  assert.equal(h.state('getFollowUp', 'f1').data.status, 'OPEN');
  h.server.mutate = () => { h.server.followups[0].status = 'OPEN'; return {}; };
  await h.dispatch('cancelAppointment', { appointmentId: 'a1', body: { reason: 'PATIENT_CANCELLED' } }); await h.settle();
  assert.equal(h.state('getFollowUp', 'f1').status, 'uninitialized');
  const returned = await h.dispatch('getFollowUp', 'f1', { subscribe: false }).unwrap();
  assert.equal(returned.status, 'OPEN');
});

test('rescheduleAppointment: inactive detail cache is evicted and return loads the new state/link', async t => {
  const h = harness(t, 5);
  await h.dispatch('getFollowUp', 'f1', { subscribe: false });
  h.server.mutate = () => { h.server.followups[0].linked_appointment = { appointment_id: 'a1', date: '2026-10-18', time: '11:00:00' }; return {}; };
  await h.dispatch('rescheduleAppointment', { appointmentId: 'a1', body: { date: '2026-10-18', time: '11:00:00' } }); await h.settle();
  assert.equal(h.state('getFollowUp', 'f1').status, 'uninitialized');
  const returned = await h.dispatch('getFollowUp', 'f1', { subscribe: false }).unwrap();
  assert.equal(returned.linked_appointment.time, '11:00:00');
});
