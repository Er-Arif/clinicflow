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
    'expo-router': { useRouter: () => ({ push() {}, back() {} }), useLocalSearchParams: () => ({ followupId: 'f1' }) },
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
  assert.deepEqual(h.state('followUpWorklist', h.args.followUpWorklist).data.pageParams, [0]);
  assert.equal(h.items('followUpWorklist')[0].followup_id, 'f2');
});

const mutations = [
  ['bookFollowUp', { followupId: 'f1', body: {}, idempotencyKey: 'book' }, 'BOOKED', 'SKIPPED'],
  ['closeFollowUp', { followupId: 'f1', reason: 'CONTACTED' }, 'CLOSED', 'SKIPPED'],
  ['cancelAppointment', { appointmentId: 'a1', reason: 'PATIENT_CANCELLED' }, 'OPEN', 'DUE'],
  ['rescheduleAppointment', { appointmentId: 'a1', body: {}, idempotencyKey: 'move' }, 'BOOKED', 'SKIPPED'],
  ['completeVisit', { visitId: 'v1', body: {}, idempotencyKey: 'complete' }, 'CLOSED', 'SKIPPED'],
  ['markReminderSent', 'r1', 'OPEN', 'SENT'],
  ['skipReminder', { reminderId: 'r1', reason: 'Skipped' }, 'OPEN', 'SKIPPED'],
  ['prepareReminder', { reminderId: 'r1' }, 'OPEN', 'DUE'],
];
for (const [mutation, arg, followupStatus, reminderStatus] of mutations) {
  test(`real RTK invalidation: ${mutation} refreshes affected lists/details and discards appended pages`, async t => {
    const h = harness(t);
    if (['cancelAppointment', 'rescheduleAppointment', 'completeVisit'].includes(mutation)) {
      h.server.followups[0].status = 'BOOKED';
      h.server.followups[0].linked_appointment = { appointment_id: 'a1', date: '2026-10-20', status: 'BOOKED' };
      h.server.reminders[0].status = 'SKIPPED'; h.server.reminders[0].skip_reason = 'FOLLOWUP_BOOKED';
    }
    const followArg = {}, reminderArg = {};
    await h.dispatch('followUpWorklist', followArg);
    await h.dispatch('reminderWorklist', reminderArg);
    await h.dispatch('followUpWorklist', followArg, { direction: 'forward', subscribe: false });
    await h.dispatch('reminderWorklist', reminderArg, { direction: 'forward', subscribe: false });
    await h.dispatch('getFollowUp', 'f1');
    await h.dispatch('listReminders', { status: 'DUE', followupId: 'f1' });
    if (['cancelAppointment', 'rescheduleAppointment'].includes(mutation)) {
      assert.match(h.render('detail').markup, /BOOKED/);
      assert.match(h.render('detail').markup, /2026-10-20/);
      assert.doesNotMatch(h.render('detail').markup, /Send WhatsApp Reminder/);
    }
    h.server.mutate = () => {
      h.server.followups[0].status = followupStatus;
      h.server.followups[0].linked_appointment = followupStatus === 'BOOKED'
        ? { appointment_id: 'a2', date: '2026-10-22', status: 'BOOKED' } : null;
      Object.assign(h.server.reminders[0], { status: reminderStatus, skip_reason: null, message_snapshot: 'Fresh message' });
      return { closed_previous_followup_id: 'f1', followup: h.server.followups[0], reminder: h.server.reminders[0] };
    };
    await h.dispatch(mutation, arg).unwrap(); await h.settle();
    const reminders = h.state('reminderWorklist', reminderArg).data;
    assert.equal(reminders.pages.length, 1);
    assert.equal(reminders.pages[0].items[0].status, reminderStatus);
    assert.equal(reminders.pages[0].items[0].message_snapshot, 'Fresh message');
    if (!['prepareReminder', 'markReminderSent', 'skipReminder'].includes(mutation)) {
      assert.equal(h.state('followUpWorklist', followArg).data.pages.length, 1);
      assert.equal(h.state('getFollowUp', 'f1').data.status, followupStatus);
      const detail = h.render('detail').markup;
      assert.match(detail, new RegExp(followupStatus));
      if (mutation === 'cancelAppointment') {
        assert.match(detail, /Send WhatsApp Reminder/);
        assert.equal(h.state('listReminders', { status: 'DUE', followupId: 'f1' }).data.items[0].status, 'DUE');
      }
      if (mutation === 'rescheduleAppointment') assert.match(detail, /2026-10-22/);
    }
    await h.dispatch('reminderWorklist', reminderArg, { direction: 'forward', subscribe: false });
    assert.equal(h.state('reminderWorklist', reminderArg).data.pages.length, 2);
  });
}

test('mutation removes a page-two row from the active filter without retaining a stale tail', async t => {
  const h = harness(t);
  for (const name of ['followUpWorklist', 'reminderWorklist']) {
    await h.dispatch(name, h.args[name]);
    await h.dispatch(name, h.args[name], { direction: 'forward', subscribe: false });
  }
  h.server.mutate = () => { h.server.followups[54].status = 'CLOSED'; h.server.reminders[54].status = 'SKIPPED'; return {}; };
  await h.dispatch('closeFollowUp', { followupId: 'f55', reason: 'CONTACTED' }); await h.settle();
  for (const name of ['followUpWorklist', 'reminderWorklist']) {
    assert.equal(h.state(name, h.args[name]).data.pages.length, 1);
    assert.doesNotMatch(h.render(name).markup, /Patient-55/);
    h.press(name, 'Load more'); await h.settle();
    assert.equal(h.items(name).length, 54);
    assert.doesNotMatch(h.render(name).markup, /Patient-55/);
  }
});

for (const [name, arg] of [
  ['createAppointment', { body: {}, idempotencyKey: 'create' }],
  ['checkInAppointment', { appointmentId: 'a1', idempotencyKey: 'check-in' }],
  ['blockSession', { sessionDefinitionId: 's1', date: '2026-10-15', reason: 'Leave' }],
  ['unblockSession', 'o1'],
  ['blockScheduleException', { doctorId: 'd1', body: {} }],
  ['unblockScheduleExceptions', { doctorId: 'd1', body: {} }],
  ['createAppointmentMessage', { appointmentId: 'a1', messageType: 'APPOINTMENT_CONFIRMATION' }],
]) {
  test(`${name} invalidates reminder eligibility/content`, async t => {
    const h = harness(t);
    await h.dispatch('reminderWorklist', h.args.reminderWorklist);
    h.server.mutate = () => { h.server.reminders[0].sendable = false; return {}; };
    await h.dispatch(name, arg); await h.settle();
    assert.equal(h.state('reminderWorklist', h.args.reminderWorklist).data.pages[0].items[0].sendable, false);
  });
}

for (const mutation of ['cancelAppointment', 'rescheduleAppointment']) {
  test(`${mutation}: inactive detail cache is evicted and return loads the new state/link`, async t => {
    const h = harness(t);
    h.server.followups[0].status = 'BOOKED';
    const subscription = h.dispatch('getFollowUp', 'f1'); await subscription;
    assert.match(h.render('detail').markup, /BOOKED/);
    subscription.unsubscribe();
    // Allow RTK to process the unsubscribe before invalidating the inactive entry.
    await new Promise(resolve => setTimeout(resolve, 0));
    h.server.mutate = () => {
      h.server.followups[0].status = mutation === 'cancelAppointment' ? 'OPEN' : 'BOOKED';
      h.server.followups[0].linked_appointment = mutation === 'rescheduleAppointment'
        ? { appointment_id: 'a2', date: '2026-10-22' } : null;
      return {};
    };
    await h.dispatch(mutation, { appointmentId: 'a1', body: {}, idempotencyKey: 'move', reason: 'PATIENT_CANCELLED' });
    await h.settle();
    assert.ok(h.state('getFollowUp', 'f1').isUninitialized);
    await h.dispatch('getFollowUp', 'f1');
    assert.match(h.render('detail').markup, mutation === 'cancelAppointment' ? /OPEN/ : /2026-10-22/);
  });
}
