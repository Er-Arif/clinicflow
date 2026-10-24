import { useRef, useSyncExternalStore } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { FormField } from '@/components/FormField';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { TimePicker } from '@/components/TimePicker';
import { useFocusedHardwareBack } from '@/navigation/useFocusedHardwareBack';
import { colors, radius, spacing } from '@/theme/tokens';
import { ScheduleReview } from './ScheduleReview';
import type { ScheduleOverview } from './types';
import { applySessionPatch, calculatedSlots, daySummary, defaultSession, weekdays } from './weeklyEditor';
import type { EditorErrors, SessionDraft, WeeklyDraft, WeeklyEditor } from './weeklyEditor';

function SessionCard({ session, index, count, errors, busy, onChange, onRemove, onMove }: {
  session: SessionDraft; index: number; count: number; errors: EditorErrors; busy: boolean;
  onChange: (patch: Partial<SessionDraft>) => void; onRemove: () => void; onMove: (offset: number) => void;
}) {
  const error = (field: string) => errors[session.key + '.' + field];
  const slots = calculatedSlots(session.start, session.end, session.interval);
  const capacity = Number(session.capacity);
  const lowerLimit = slots != null && Number.isFinite(capacity) && capacity > 0 && capacity < slots;
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Session {index + 1}</Text>
      <FormField label="Session name" accessibilityLabel={`Session ${index + 1} name`} value={session.name}
        maxLength={80} editable={!busy} onChangeText={name => onChange({ name })} error={error('name')} />
      <Text style={styles.label}>Start time</Text>
      <TimePicker accessibilityLabel={`Session ${index + 1} start time`} value={session.start.slice(0, 5)} disabled={busy} onChange={start => onChange({ start })} />
      {error('start') ? <Text style={styles.error}>{error('start')}</Text> : null}
      <Text style={styles.label}>End time</Text>
      <TimePicker accessibilityLabel={`Session ${index + 1} end time`} value={session.end.slice(0, 5)} disabled={busy} onChange={end => onChange({ end })} />
      {error('end') ? <Text style={styles.error}>{error('end')}</Text> : null}
      <FormField label="Slot interval (minutes)" accessibilityLabel={`Session ${index + 1} slot interval`}
        keyboardType="number-pad" value={session.interval} editable={!busy}
        onChangeText={interval => onChange({ interval })} error={error('interval')} />
      <FormField label="Booking capacity" accessibilityLabel={`Session ${index + 1} booking capacity`}
        keyboardType="number-pad" value={session.capacity} editable={!busy} maxLength={3}
        onChangeText={capacityValue => onChange({ capacity: capacityValue })} error={error('capacity')} />
      <View style={styles.capacityInfo}>
        <Text style={styles.capacityTitle}>{slots == null ? 'Capacity will calculate automatically' : `${slots} complete slot${slots === 1 ? '' : 's'} available`}</Text>
        <Text style={styles.capacityHint}>
          {slots == null
            ? 'Set valid start/end times and a slot interval.'
            : lowerLimit
              ? `Booking limit is lowered to ${session.capacity}.`
              : 'Capacity follows the session automatically. Lower it only if you want booking buffer.'}
        </Text>
      </View>
      <View style={styles.row}>
        <AppButton compact label="Move up" tone="secondary" disabled={busy || index === 0} onPress={() => onMove(-1)} />
        <AppButton compact label="Move down" tone="secondary" disabled={busy || index === count - 1} onPress={() => onMove(1)} />
      </View>
      <AppButton compact label={`Remove session ${index + 1}`} tone="danger" disabled={busy} onPress={onRemove} />
    </View>
  );
}

export function WeeklyScheduleEditor({ editor, overview, loadedFrom, onBack }: {
  editor: WeeklyEditor; overview: ScheduleOverview; loadedFrom: string; onBack: () => void;
}) {
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const nextKey = useRef(0);
  const busy = state.phase === 'previewing' || state.phase === 'applying' || state.phase === 'saved';
  const change = (update: (draft: WeeklyDraft) => WeeklyDraft) => editor.edit(update(editor.getSnapshot().draft));

  // The UI intentionally removes/disables Back while preview/apply is in flight.
  // Android hardware Back must obey the same lock instead of escaping the route.
  useFocusedHardwareBack(() => {}, busy);

  const add = () => change(draft => {
    if (draft.sessions.length >= 12) return draft;
    const session = defaultSession(`added-${++nextKey.current}`);
    const latest = draft.sessions.map(s => s.end).sort().at(-1);
    if (latest && Number(latest.slice(0, 2)) < 21) {
      session.start = latest.slice(0, 5);
      session.end = `${String(Number(latest.slice(0, 2)) + 3).padStart(2, '0')}:${latest.slice(3, 5)}`;
    }
    return { ...draft, sessions: [...draft.sessions, session] };
  });
  return (
    <KeyboardSafeFormScreen footer={<View style={styles.footer}>
      {state.message ? <Text accessibilityRole="alert" style={styles.error}>{state.message}</Text> : null}
      <AppButton label="Preview changes" loading={state.phase === 'previewing'} disabled={busy}
        onPress={() => { Keyboard.dismiss(); void editor.preview(); }} />
      {Object.keys(state.errors).length ? <Text accessibilityRole="alert" style={styles.error}>Check the highlighted fields above.</Text> : null}
      <AppButton compact label="Cancel" tone="secondary" disabled={busy} onPress={onBack} />
    </View>}>
      {!busy ? <BackButton onPress={onBack} /> : null}
      <Text accessibilityRole="header" style={styles.title}>Edit weekly hours</Text>
      <Text style={styles.hint}>Based on {loadedFrom}. Select the days that should share this schedule, then review before saving.</Text>
      <View style={styles.row}>
        {weekdays.map((name, day) => {
          const selected = state.draft.weekdays.includes(day);
          return <Pressable key={name} accessibilityRole="checkbox" accessibilityLabel={name}
            accessibilityState={{ checked: selected, disabled: busy }} disabled={busy}
            style={[styles.chip, selected && styles.selected]}
            onPress={() => change(draft => ({ ...draft, weekdays: draft.weekdays.includes(day)
              ? draft.weekdays.filter(value => value !== day) : [...draft.weekdays, day] }))}>
            <Text style={selected ? styles.selectedText : styles.text}>{selected ? '✓ ' : ''}{name.slice(0, 3)}</Text>
          </Pressable>;
        })}
      </View>
      {state.errors.weekdays ? <Text style={styles.error}>{state.errors.weekdays}</Text> : null}
      {overview.days.filter(day => state.draft.weekdays.includes(day.weekday)).map(day => (
        <Text key={day.weekday} style={styles.daySummary}>{day.weekday_name}: {daySummary(day)}</Text>
      ))}
      <View style={styles.row}>
        {[true, false].map(working => <Pressable key={String(working)} accessibilityRole="radio"
          accessibilityLabel={working ? 'Working day' : 'Day off'}
          accessibilityState={{ selected: state.draft.working === working, disabled: busy }} disabled={busy}
          style={[styles.chip, state.draft.working === working && styles.selected]}
          onPress={() => change(draft => ({ ...draft, working, sessions: working && !draft.sessions.length
            ? [defaultSession(`added-${++nextKey.current}`)] : draft.sessions }))}>
          <Text style={state.draft.working === working ? styles.selectedText : styles.text}>
            {state.draft.working === working ? '✓ ' : ''}{working ? 'Working day' : 'Day off'}
          </Text>
        </Pressable>)}
      </View>
      {state.draft.working ? <>
        {state.draft.sessions.map((session, index) => <SessionCard key={session.key} session={session}
          index={index} count={state.draft.sessions.length} errors={state.errors} busy={busy}
          onChange={patch => change(draft => ({ ...draft, sessions: draft.sessions.map(s => s.key === session.key ? applySessionPatch(s, patch) : s) }))}
          onRemove={() => change(draft => ({ ...draft, sessions: draft.sessions.filter(s => s.key !== session.key) }))}
          onMove={offset => change(draft => {
            const sessions = [...draft.sessions];
            const current = sessions.findIndex(s => s.key === session.key);
            const target = current + offset;
            if (current < 0 || target < 0 || target >= sessions.length) return draft;
            [sessions[current], sessions[target]] = [sessions[target], sessions[current]];
            return { ...draft, sessions };
          })} />)}
        {state.errors.sessions ? <Text style={styles.error}>{state.errors.sessions}</Text> : null}
        <AppButton compact label="Add session" tone="secondary" disabled={busy || state.draft.sessions.length >= 12} onPress={add} />
      </> : <Text style={styles.hint}>No sessions will be proposed for these days.</Text>}
      {state.review ? <ScheduleReview review={state.review} applying={state.phase === 'applying'}
        onEdit={() => editor.edit(state.draft)} onApply={() => { void editor.apply(); }} /> : null}
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: colors.primaryDark },
  heading: { fontSize: 16, fontWeight: '800', color: colors.primaryDark },
  text: { color: colors.text, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  daySummary: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  label: { color: colors.text, fontSize: 13, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minHeight: 42, paddingHorizontal: 11, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  selectedText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  capacityInfo: { backgroundColor: colors.surfaceSoft, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 9, gap: 2 },
  capacityTitle: { color: colors.primaryDark, fontSize: 12, fontWeight: '700' },
  capacityHint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  footer: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
});