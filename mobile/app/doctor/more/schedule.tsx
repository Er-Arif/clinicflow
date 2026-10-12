import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { apiError } from '@/api/errors';
import {
  useBlockSessionMutation,
  useClinicTimeQuery,
  useGetAvailabilityQuery,
  useGetScheduleQuery,
  useListDoctorsQuery,
  useReplaceMultiDayScheduleMutation,
  useUnblockSessionMutation,
} from '@/api/api';
import { DatePicker } from '@/components/DatePicker';
import { TimePicker } from '@/components/TimePicker';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { FormField } from '@/components/FormField';
import { SessionWrite } from '@/features/scheduling/types';
import { colors, radius, spacing } from '@/theme/tokens';

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const blankSession = (order: number): SessionWrite => ({
  session_name: order === 0 ? 'Morning' : 'Session',
  start_time: '10:00:00',
  end_time: '13:00:00',
  slot_interval_minutes: 15,
  maximum_capacity: 10,
  active: true,
  display_order: order,
});

export default function ScheduleSettingsScreen() {
  const clinicTime = useClinicTimeQuery();
  const today = clinicTime.data?.clinic_date ?? '';
  const doctors = useListDoctorsQuery();
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const doctorId = selectedDoctor ?? doctors.data?.[0]?.doctor_id ?? '';
  const schedule = useGetScheduleQuery({ doctorId, effectiveOn: today }, { skip: !doctorId });

  // Multi-day selection: array of selected weekday indexes (e.g. [0, 1, 2, 3, 4] for Mon-Fri)
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([0]);

  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [sessions, setSessions] = useState<SessionWrite[]>([blankSession(0)]);
  const [message, setMessage] = useState<string | null>(null);
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [saveMultiDaySchedule, saveState] = useReplaceMultiDayScheduleMutation();

  const [blockDate, setBlockDate] = useState('');
  const [blockReason, setBlockReason] = useState('Doctor unavailable');
  const availability = useGetAvailabilityQuery(
    { doctorId, date: blockDate },
    { skip: !doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(blockDate) },
  );
  const [blockSession, blockState] = useBlockSessionMutation();
  const [unblockSession, unblockState] = useUnblockSessionMutation();

  useEffect(() => {
    if (today && !blockDate) setBlockDate(today);
  }, [today, blockDate]);

  // Inspect existing schedules for selected weekdays to detect mixed configurations
  const selectedDaysData = (schedule.data?.days ?? []).filter((d) => selectedWeekdays.includes(d.weekday));
  const distinctEffectiveFroms = Array.from(new Set(selectedDaysData.map((d) => d.effective_from)));
  const hasMixedEffectiveDates = distinctEffectiveFroms.length > 1;
  const hasUnscheduledAndScheduled = selectedDaysData.length > 0 && selectedDaysData.length < selectedWeekdays.length;

  // Determine if selected days have different schedules
  const hasMixedExistingSchedules = (() => {
    if (selectedDaysData.length <= 1) {
      // If some days have schedules and others don't, that's mixed
      return selectedDaysData.length > 0 && selectedDaysData.length < selectedWeekdays.length;
    }
    // Compare session signatures of the scheduled days
    const signatures = selectedDaysData.map((d) =>
      d.sessions
        .filter((s) => s.active !== false)
        .map((s) => `${s.session_name.trim()}|${shortTime(s.start_time)}|${shortTime(s.end_time)}|${s.slot_interval_minutes}|${s.maximum_capacity}`)
        .sort()
        .join(';')
    );
    const allSame = signatures.every((sig) => sig === signatures[0]);
    return !allSame || selectedDaysData.length < selectedWeekdays.length || hasMixedEffectiveDates;
  })();

  // When changing primary weekday, initialize the editor with that scheduled day's sessions or defaults
  const primaryWeekday = selectedWeekdays[0] ?? 0;
  const isScheduleQueryLoaded = Boolean(schedule.data && !schedule.isLoading);
  const primaryDay = schedule.data?.days.find((day) => day.weekday === primaryWeekday);

  // Track hydration state using schedule identity and version to prevent premature fallback or edit-wiping
  const hydratedScheduleKeyRef = useRef<string | null>(null);

  const targetScheduleKey = isScheduleQueryLoaded
    ? primaryDay
      ? `${doctorId}:${primaryWeekday}:${primaryDay.schedule_definition_id}:v${primaryDay.version}`
      : `${doctorId}:${primaryWeekday}:unscheduled`
    : null;

  useEffect(() => {
    if (!isScheduleQueryLoaded || targetScheduleKey === null) {
      // Query is still in-flight. DO NOT mark as hydrated and DO NOT overwrite with fallback.
      return;
    }

    if (hydratedScheduleKeyRef.current !== targetScheduleKey) {
      hydratedScheduleKeyRef.current = targetScheduleKey;
      setOverwriteConfirmed(false);

      if (primaryDay) {
        setEffectiveFrom(primaryDay.effective_from);
        setSessions(
          primaryDay.sessions
            .filter((s) => s.active !== false)
            .map((item, index) => ({
              session_name: item.session_name,
              start_time: normalizeTime(item.start_time),
              end_time: normalizeTime(item.end_time),
              slot_interval_minutes: item.slot_interval_minutes,
              maximum_capacity: item.maximum_capacity,
              active: item.active,
              display_order: index,
            })),
        );
      } else {
        // Query finished and confirmed no schedule exists for this weekday
        if (today) setEffectiveFrom(today);
        setSessions([blankSession(0)]);
      }
    }
  }, [isScheduleQueryLoaded, targetScheduleKey, primaryDay, today]);

  function toggleWeekday(index: number) {
    setSelectedWeekdays((prev) => {
      if (prev.includes(index)) {
        if (prev.length === 1) return prev; // Keep at least one selected
        return prev.filter((w) => w !== index);
      } else {
        return [...prev, index].sort((a, b) => a - b);
      }
    });
  }

  function patchSession(index: number, patch: Partial<SessionWrite>) {
    setSessions((previous) => previous.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function save() {
    if (!doctorId || selectedWeekdays.length === 0) return;
    if (selectedWeekdays.length > 1) {
      if (hasMixedEffectiveDates && effectiveFrom < today) {
        setMessage(
          `Selected days have different schedule version dates (${distinctEffectiveFroms.join(', ')}). To edit in-place, edit each weekday individually, or select an effective date from ${today} onwards.`
        );
        return;
      }
      if (hasUnscheduledAndScheduled && effectiveFrom < today) {
        setMessage(
          `Some selected days are not yet scheduled. To configure them together, select an effective date from ${today} onwards.`
        );
        return;
      }
      if (hasMixedExistingSchedules && !overwriteConfirmed) {
        setMessage('Please confirm applying this schedule to all selected days before saving.');
        return;
      }
    }
    setMessage(null);
    try {
      await saveMultiDaySchedule({
        doctorId,
        weekdays: selectedWeekdays,
        effectiveFrom,
        sessions,
      }).unwrap();
      setMessage(`Schedule version saved for ${selectedWeekdays.map((w) => weekdays[w]).join(', ')}.`);
      setOverwriteConfirmed(false);
      void schedule.refetch();
      void availability.refetch();
    } catch (error) {
      const err = apiError(error);
      const detailMsg = (err?.details as any)?.fields?.[0]?.message;
      setMessage(detailMsg || err?.message || 'Unable to save the schedule.');
    }
  }

  async function block(sessionDefinitionId: string) {
    if (!blockReason.trim()) {
      setMessage('Enter a reason before blocking the session.');
      return;
    }
    try {
      await blockSession({ sessionDefinitionId, date: blockDate, reason: blockReason.trim() }).unwrap();
      void availability.refetch();
    } catch (error) {
      setMessage(apiError(error)?.message ?? 'Unable to block the session.');
    }
  }

  async function unblock(occurrenceId: string) {
    try {
      await unblockSession(occurrenceId).unwrap();
      void availability.refetch();
    } catch (error) {
      setMessage(apiError(error)?.message ?? 'Unable to unblock the session.');
    }
  }

  return (
    <AppScreen>
      <BackButton />
      <Text style={styles.title}>Schedule Settings</Text>
      <Text style={styles.subtitle}>Recurring schedule versions never move existing bookings.</Text>

      <Text style={styles.label}>Doctor</Text>
      <View style={styles.chips}>
        {doctors.data?.map((doctor) => (
          <Pressable
            key={doctor.doctor_id}
            onPress={() => setSelectedDoctor(doctor.doctor_id)}
            style={[styles.chip, doctorId === doctor.doctor_id && styles.chipActive]}
          >
            <Text style={doctorId === doctor.doctor_id ? styles.chipTextActive : styles.chipText}>
              {doctor.display_name}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Working Days (Select one or multiple)</Text>
      <View style={styles.chips}>
        {weekdays.map((label, index) => {
          const isSelected = selectedWeekdays.includes(index);
          return (
            <Pressable
              key={label}
              onPress={() => toggleWeekday(index)}
              style={[styles.dayChip, isSelected && styles.chipActive]}
            >
              <Text style={isSelected ? styles.chipTextActive : styles.chipText}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Overview of current schedules for selected days */}
      {selectedWeekdays.length === 1 ? (
        primaryDay ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Current {weekdays[primaryWeekday]} schedule</Text>
            {primaryDay.sessions.map((session) => (
              <Text key={session.session_definition_id} style={styles.subtitle}>
                {session.session_name}: {shortTime(session.start_time)}–{shortTime(session.end_time)} · {session.slot_interval_minutes} min · capacity {session.maximum_capacity}
              </Text>
            ))}
            <Text style={styles.subtitle}>
              Version {primaryDay.version} active from {primaryDay.effective_from}. Saving updates this schedule version.
            </Text>
          </View>
        ) : (
          <Text style={styles.subtitle}>No active schedule for {weekdays[primaryWeekday]}.</Text>
        )
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Selected: {selectedWeekdays.map((w) => weekdays[w]).join(', ')}</Text>
          {hasMixedExistingSchedules ? (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>Selected days currently have different schedules or some days are unscheduled.</Text>
              {!overwriteConfirmed ? (
                <AppButton
                  label="Apply this schedule to all selected days"
                  tone="secondary"
                  onPress={() => setOverwriteConfirmed(true)}
                />
              ) : (
                <Text style={styles.success}>✓ Overwrite confirmed. Saving will apply this schedule to {selectedWeekdays.map((w) => weekdays[w]).join(', ')}.</Text>
              )}
            </View>
          ) : (
            <Text style={styles.subtitle}>All selected days currently share the same schedule.</Text>
          )}
        </View>
      )}

      <View style={{ gap: 4 }}><Text style={{ fontWeight: '800' }}>Effective From</Text><DatePicker value={effectiveFrom} onChange={setEffectiveFrom} placeholder="YYYY-MM-DD" /></View>

      {sessions.map((session, index) => (
        <View key={`session-${index}`} style={styles.sessionCard}>
          <View style={styles.header}>
            <Text style={styles.cardTitle}>Session {index + 1}</Text>
            {sessions.length > 1 ? (
              <Pressable onPress={() => setSessions((items) => items.filter((_, i) => i !== index).map((item, i) => ({ ...item, display_order: i })))}>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
          <FormField label="Session Name" value={session.session_name} onChangeText={(value) => patchSession(index, { session_name: value })} />
          <View style={styles.twoColumns}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.timeLabel}>Start</Text>
              <TimePicker
                value={shortTime(session.start_time)}
                onChange={(value) => patchSession(index, { start_time: normalizeTime(value) })}
                placeholder="10:00"
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.timeLabel}>End</Text>
              <TimePicker
                value={shortTime(session.end_time)}
                onChange={(value) => patchSession(index, { end_time: normalizeTime(value) })}
                placeholder="13:00"
              />
            </View>
          </View>
          <View style={styles.twoColumns}>
            <View style={{ flex: 1 }}><FormField label="Slot Minutes" value={String(session.slot_interval_minutes)} onChangeText={(value) => patchSession(index, { slot_interval_minutes: Number(value) || 0 })} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><FormField label="Max Capacity" value={String(session.maximum_capacity)} onChangeText={(value) => patchSession(index, { maximum_capacity: Number(value) || 0 })} keyboardType="number-pad" /></View>
          </View>
        </View>
      ))}

      <AppButton label="Add Session" tone="secondary" onPress={() => setSessions((items) => [...items, blankSession(items.length)])} />
      <AppButton label="Disable Selected Day(s) From Date" tone="secondary" onPress={() => setSessions([])} />
      {message ? <Text style={message.includes('saved') ? styles.success : styles.error}>{message}</Text> : null}
      <AppButton
        label={selectedWeekdays.length > 1 ? `Save Schedule for ${selectedWeekdays.length} Days` : 'Save Schedule Version'}
        loading={saveState.isLoading}
        onPress={() => void save()}
      />

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>Date-specific Doctor Unavailability</Text>
      <Text style={styles.subtitle}>Blocking one date does not disable the recurring weekly schedule.</Text>
      <View style={{ gap: 4 }}><Text style={{ fontWeight: '800' }}>Date</Text><DatePicker value={blockDate} onChange={setBlockDate} placeholder="YYYY-MM-DD" /></View>
      <FormField label="Reason" value={blockReason} onChangeText={setBlockReason} placeholder="Doctor unavailable" />
      {availability.data?.sessions.map((session) => (
        <View key={session.session_definition_id} style={styles.card}>
          <Text style={styles.cardTitle}>{session.name}</Text>
          <Text style={styles.subtitle}>{shortTime(session.start_time)}–{shortTime(session.end_time)}</Text>
          {session.status === 'BLOCKED' && session.session_occurrence_id ? (
            <AppButton
              label="Unblock Session"
              tone="secondary"
              loading={unblockState.isLoading}
              onPress={() => void unblock(session.session_occurrence_id!)}
            />
          ) : (
            <AppButton
              label="Block Session for This Date"
              tone="danger"
              loading={blockState.isLoading}
              onPress={() => void block(session.session_definition_id)}
            />
          )}
        </View>
      ))}
    </AppScreen>
  );
}

function normalizeTime(value: string) {
  const cleaned = value.trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(cleaned)) return cleaned;
  if (/^\d{2}:\d{2}$/.test(cleaned)) return `${cleaned}:00`;
  return cleaned;
}

function shortTime(value: string) {
  return value.slice(0, 5);
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '700', paddingTop: 6 },
  label: { color: colors.text, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  dayChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, minWidth: 46, alignItems: 'center', paddingVertical: 9 },
  chipActive: { backgroundColor: colors.softPrimary, borderColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm },
  sessionCard: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.md },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: 17 },
  twoColumns: { flexDirection: 'row', gap: spacing.sm },
  timeLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  warningBox: { backgroundColor: colors.softWarning, borderColor: colors.warning, borderWidth: 1, borderRadius: radius.sm, padding: spacing.sm, gap: spacing.sm },
  warningText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  remove: { color: colors.danger, fontWeight: '700' },
  success: { color: colors.success, fontWeight: '700' },
  error: { color: colors.danger },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
});
