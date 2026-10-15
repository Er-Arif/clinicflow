import { apiError } from '../../api/errors';
import type { ScheduleApply, ScheduleDay, ScheduleOverview, SchedulePreview, ScheduleProposal, WeekdayOverview } from './types';

export const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export type SessionDraft = {
  key: string; name: string; start: string; end: string; interval: string; capacity: string;
};
export type WeeklyDraft = { weekdays: number[]; working: boolean; sessions: SessionDraft[] };
export type EditorErrors = Record<string, string>;
export const defaultSession = (key: string): SessionDraft => ({
  key, name: 'Clinic session', start: '09:00', end: '12:00', interval: '15', capacity: '12',
});
export const isWorking = (day: ScheduleDay | null) => !!day?.active && day.sessions.some(s => s.active);

export function dateLabel(value: string) {
  // Date-only clinic values must not be interpreted as UTC midnight on the device.
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function daySummary(day: WeekdayOverview) {
  const current = isWorking(day.current) ? 'Currently working' : 'Currently off';
  return day.upcoming
    ? `${current} · Planned ${isWorking(day.upcoming) ? 'working hours' : 'day off'} from ${dateLabel(day.upcoming.effective_from)}`
    : current;
}

export function initialDraft(overview: ScheduleOverview, param?: string | string[]): WeeklyDraft {
  const value = Array.isArray(param) ? param[0] : param;
  const weekday = value && /^[0-6]$/.test(value) ? Number(value) : 0;
  const day = overview.days.find(item => item.weekday === weekday);
  const definition = day?.upcoming ?? day?.current ?? null;
  return {
    weekdays: [weekday], working: definition ? isWorking(definition) : true,
    sessions: definition?.sessions.filter(s => s.active).sort((a, b) => a.display_order - b.display_order).map(s => ({
      key: s.session_definition_id, name: s.session_name, start: s.start_time, end: s.end_time,
      interval: String(s.slot_interval_minutes), capacity: String(s.maximum_capacity),
    })) ?? [defaultSession('initial')],
  };
}

function seconds(value: string) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,6})?)?$/.exec(value);
  if (!match || +match[1] > 23 || +match[2] > 59 || +(match[3] ?? 0) > 59) return NaN;
  return +match[1] * 3600 + +match[2] * 60 + +(match[3] ?? 0) + +(match[4] ?? 0);
}

export function validateDraft(draft: WeeklyDraft): { errors: EditorErrors; proposal: ScheduleProposal } {
  const errors: EditorErrors = {};
  if (!draft.weekdays.length) errors.weekdays = 'Select at least one weekday.';
  if (draft.working && !draft.sessions.length) errors.sessions = 'Add at least one session for a working day.';
  if (draft.working && draft.sessions.length > 12) errors.sessions = 'Use no more than 12 sessions.';
  const sessions = draft.working ? draft.sessions.map((s, index) => {
    const start = seconds(s.start), end = seconds(s.end);
    const interval = Number(s.interval), capacity = Number(s.capacity);
    const prefix = s.key + '.';
    if (!s.name.trim() || s.name.trim().length > 80) errors[prefix + 'name'] = 'Enter a name of 1–80 characters.';
    if (!Number.isFinite(start)) errors[prefix + 'start'] = 'Select a valid start time.';
    if (!Number.isFinite(end) || end <= start) errors[prefix + 'end'] = 'End time must be later than start time.';
    if (!/^\d+$/.test(s.interval) || interval < 1 || interval > 240) errors[prefix + 'interval'] = 'Enter 1–240 whole minutes.';
    if (!/^\d+$/.test(s.capacity) || capacity < 1 || capacity > 500) errors[prefix + 'capacity'] = 'Enter a whole capacity from 1 to 500.';
    else if (interval > 0 && capacity > Math.floor((end - start) / (interval * 60))) {
      errors[prefix + 'capacity'] = 'Capacity cannot exceed the number of complete slots in this session.';
    }
    if (draft.sessions.some((other, i) => i !== index && start < seconds(other.end) && seconds(other.start) < end)) {
      errors[prefix + 'start'] = 'Sessions must not overlap. Adjust their start and end times.';
    }
    return {
      session_name: s.name.trim(), start_time: s.start, end_time: s.end,
      slot_interval_minutes: interval, maximum_capacity: capacity, active: true, display_order: index,
    };
  }) : [];
  return { errors, proposal: { weekdays: [...draft.weekdays].sort((a, b) => a - b), sessions } };
}

export function schedulingError(error: unknown, applying = false) {
  const code = apiError(error)?.code;
  switch (code) {
    case 'STALE_SCHEDULE_PREVIEW': return 'The schedule changed or this review expired. Your edits are saved here. Preview the changes again before applying.';
    case 'UNRESOLVABLE_APPOINTMENT_CONFLICT': return 'These changes cannot currently be applied. Review existing appointments and planned hours, or adjust the proposed sessions and preview again.';
    case 'SCHEDULE_OCCUPANCY_CONFLICT': return 'Existing appointments cannot be safely matched to these sessions. Review the appointments and session times before trying again.';
    case 'PERMISSION_DENIED': return 'You do not have permission to change the weekly schedule. Contact the clinic owner.';
    case 'VALIDATION_ERROR': return 'Check the session names, times, intervals and capacities, then preview again.';
    case 'NETWORK_UNAVAILABLE': return applying
      ? 'The result could not be confirmed. Check the weekly schedule before trying again; the change may have been saved.'
      : 'Unable to reach ClinicFlow. Check your connection and preview again.';
    default: return applying
      ? 'Unable to confirm the change. Check the weekly schedule, then preview again before applying.'
      : 'Unable to preview these changes. Check your connection and try again.';
  }
}

export type EditorState = {
  draft: WeeklyDraft; errors: EditorErrors; message: string | null;
  phase: 'editing' | 'previewing' | 'review' | 'applying' | 'saved';
  review: { payload: ScheduleProposal; result: SchedulePreview } | null;
};
type Services = {
  preview: (body: ScheduleProposal) => Promise<SchedulePreview>;
  apply: (body: ScheduleApply) => Promise<ScheduleOverview>;
  onApplied: () => void;
};

// One screen-scoped workflow owns the exact reviewed payload and token. Its
// synchronous phase guard also prevents taps before React has rerendered.
export function createWeeklyEditor(draft: WeeklyDraft, services: Services) {
  let state: EditorState = { draft, errors: {}, message: null, phase: 'editing', review: null };
  let revision = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<EditorState>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    edit(next: WeeklyDraft) {
      if (state.phase === 'applying' || state.phase === 'saved') return;
      revision++;
      publish({ draft: next, review: null, errors: {}, message: null,
        phase: state.phase === 'previewing' ? 'previewing' : 'editing' });
    },
    async preview() {
      if (state.phase === 'previewing' || state.phase === 'applying' || state.phase === 'saved') return;
      const { errors, proposal } = validateDraft(state.draft);
      if (Object.keys(errors).length) { publish({ errors, review: null, phase: 'editing' }); return; }
      const requestedRevision = revision;
      publish({ phase: 'previewing', errors: {}, message: null, review: null });
      try {
        const result = await services.preview(proposal);
        if (requestedRevision === revision) publish({ phase: 'review', review: { payload: proposal, result } });
      } catch (error) {
        if (requestedRevision === revision) publish({ phase: 'editing', message: schedulingError(error) });
      } finally {
        if (requestedRevision !== revision) publish({ phase: 'editing' });
      }
    },
    async apply() {
      if (state.phase !== 'review' || !state.review) return;
      const { payload, result } = state.review;
      publish({ phase: 'applying', message: null });
      try {
        await services.apply({ ...payload, proposal_token: result.proposal_token });
        publish({ phase: 'saved', review: null });
        services.onApplied();
      } catch (error) {
        publish({ phase: 'editing', review: null, message: schedulingError(error, true) });
      }
    },
  };
}
export type WeeklyEditor = ReturnType<typeof createWeeklyEditor>;
