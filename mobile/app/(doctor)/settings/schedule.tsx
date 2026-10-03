import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import {
  useBlockSessionMutation,
  useClinicTimeQuery,
  useGetAvailabilityQuery,
  useGetScheduleQuery,
  useListDoctorsQuery,
  useReplaceWeekdayScheduleMutation,
  useUnblockSessionMutation,
} from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
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
  const router = useRouter();
  const clinicTime = useClinicTimeQuery();
  const today = clinicTime.data?.clinic_date ?? '';
  const tomorrow = today ? addDays(today, 1) : '';
  const doctors = useListDoctorsQuery();
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const doctorId = selectedDoctor ?? doctors.data?.[0]?.doctor_id ?? '';
  const schedule = useGetScheduleQuery({ doctorId, effectiveOn: today }, { skip: !doctorId });
  const [weekday, setWeekday] = useState(0);
  const currentDay = schedule.data?.days.find((day) => day.weekday === weekday);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [sessions, setSessions] = useState<SessionWrite[]>([blankSession(0)]);
  const [message, setMessage] = useState<string | null>(null);
  const [saveSchedule, saveState] = useReplaceWeekdayScheduleMutation();

  const [blockDate, setBlockDate] = useState('');
  const [blockReason, setBlockReason] = useState('Doctor unavailable');
  const availability = useGetAvailabilityQuery(
    { doctorId, date: blockDate },
    { skip: !doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(blockDate) },
  );
  const [blockSession, blockState] = useBlockSessionMutation();
  const [unblockSession, unblockState] = useUnblockSessionMutation();

  useEffect(() => {
    if (today && !effectiveFrom) setEffectiveFrom(today);
    if (today && !blockDate) setBlockDate(today);
  }, [today, effectiveFrom, blockDate]);

  useEffect(() => {
    if (!currentDay) {
      setEffectiveFrom(today);
      setSessions([blankSession(0)]);
      return;
    }
    setEffectiveFrom(tomorrow);
    setSessions(
      currentDay.sessions.map((item, index) => ({
        session_name: item.session_name,
        start_time: normalizeTime(item.start_time),
        end_time: normalizeTime(item.end_time),
        slot_interval_minutes: item.slot_interval_minutes,
        maximum_capacity: item.maximum_capacity,
        active: item.active,
        display_order: index,
      })),
    );
  }, [currentDay?.schedule_definition_id, today, tomorrow]);

  function patchSession(index: number, patch: Partial<SessionWrite>) {
    setSessions((previous) => previous.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function save() {
    if (!doctorId) return;
    setMessage(null);
    try {
      await saveSchedule({ doctorId, weekday, effectiveFrom, sessions }).unwrap();
      setMessage('Schedule version saved.');
      void schedule.refetch();
      void availability.refetch();
    } catch (error) {
      setMessage(apiError(error)?.message ?? 'Unable to save the schedule.');
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
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Schedule Settings</Text>
          <Text style={styles.subtitle}>Recurring schedule versions never move existing bookings.</Text>
        </View>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      </View>

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

      <Text style={styles.label}>Working Day</Text>
      <View style={styles.chips}>
        {weekdays.map((label, index) => (
          <Pressable
            key={label}
            onPress={() => setWeekday(index)}
            style={[styles.dayChip, weekday === index && styles.chipActive]}
          >
            <Text style={weekday === index ? styles.chipTextActive : styles.chipText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {currentDay ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Current {weekdays[weekday]} schedule</Text>
          {currentDay.sessions.map((session) => (
            <Text key={session.session_definition_id} style={styles.subtitle}>
              {session.session_name}: {shortTime(session.start_time)}–{shortTime(session.end_time)} · {session.slot_interval_minutes} min · capacity {session.maximum_capacity}
            </Text>
          ))}
          <Text style={styles.subtitle}>Changes below default to {tomorrow} as a new version.</Text>
        </View>
      ) : (
        <Text style={styles.subtitle}>No active schedule for {weekdays[weekday]}.</Text>
      )}

      <FormField label="Effective From" value={effectiveFrom} onChangeText={setEffectiveFrom} placeholder="YYYY-MM-DD" />

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
            <View style={{ flex: 1 }}><FormField label="Start" value={shortTime(session.start_time)} onChangeText={(value) => patchSession(index, { start_time: normalizeTime(value) })} placeholder="10:00" /></View>
            <View style={{ flex: 1 }}><FormField label="End" value={shortTime(session.end_time)} onChangeText={(value) => patchSession(index, { end_time: normalizeTime(value) })} placeholder="13:00" /></View>
          </View>
          <View style={styles.twoColumns}>
            <View style={{ flex: 1 }}><FormField label="Slot Minutes" value={String(session.slot_interval_minutes)} onChangeText={(value) => patchSession(index, { slot_interval_minutes: Number(value) || 0 })} keyboardType="number-pad" /></View>
            <View style={{ flex: 1 }}><FormField label="Max Capacity" value={String(session.maximum_capacity)} onChangeText={(value) => patchSession(index, { maximum_capacity: Number(value) || 0 })} keyboardType="number-pad" /></View>
          </View>
        </View>
      ))}

      <AppButton label="Add Session" tone="secondary" onPress={() => setSessions((items) => [...items, blankSession(items.length)])} />
      <AppButton label="Disable This Day From Date" tone="secondary" onPress={() => setSessions([])} />
      {message ? <Text style={message.includes('saved') ? styles.success : styles.error}>{message}</Text> : null}
      <AppButton label="Save Schedule Version" loading={saveState.isLoading} onPress={() => void save()} />

      <View style={styles.divider} />
      <Text style={styles.sectionTitle}>Date-specific Doctor Unavailability</Text>
      <Text style={styles.subtitle}>Blocking one date does not disable the recurring weekly schedule.</Text>
      <FormField label="Date" value={blockDate} onChangeText={setBlockDate} placeholder="YYYY-MM-DD" />
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

function addDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
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
  remove: { color: colors.danger, fontWeight: '700' },
  success: { color: colors.success, fontWeight: '700' },
  error: { color: colors.danger },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
});
