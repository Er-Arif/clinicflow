import { formatClinicDate, formatClinicTime } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useCloseFollowUpMutation, useGetFollowUpQuery, useListRemindersQuery } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

function humanize(value: string) {
  const normalized = value.replaceAll('_', ' ').trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : value;
}

export default function FollowUpDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ followupId: string }>();
  const followupId = String(params.followupId ?? '');
  const query = useGetFollowUpQuery(followupId, { skip: !followupId });
  const reminderQuery = useListRemindersQuery({ status: 'DUE', followupId }, { skip: !followupId });
  const [closeFollowUp, closeState] = useCloseFollowUpMutation();
  const [showClose, setShowClose] = useState(false);
  const [reason, setReason] = useState('PATIENT_DECLINED');
  const [note, setNote] = useState('');

  if (query.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!query.data) {
    return (
      <AppScreen>
        <BackButton />
        <Text style={styles.title}>Unable to load follow-up</Text>
        <QueryState query={query} label="follow-up" />
      </AppScreen>
    );
  }
  const item = query.data;
  const statusColor = item.overdue
    ? colors.danger
    : item.status === 'BOOKED'
      ? colors.success
      : item.status === 'OPEN'
        ? colors.primary
        : colors.muted;

  async function close() {
    try {
      await closeFollowUp({ followupId, reason, note: note || undefined }).unwrap();
      setShowClose(false);
    } catch {
      // Stable API error shown below.
    }
  }

  return (
    <KeyboardSafeFormScreen>
      <QueryState query={query} label="follow-up" />
      <BackButton />
      <Text style={styles.title}>Follow-up details</Text>
      <Text style={[styles.status, { color: statusColor }]}>{item.overdue ? 'Overdue' : humanize(item.status)}</Text>
      <View style={styles.card}>
        <Row label="Patient" value={item.patient.full_name} />
        <Row label="Patient ID" value={item.patient.patient_code} />
        <Row label="Due" value={formatClinicDate(item.due_date)} />
        <Row label="Source visit" value={formatClinicDate(item.source_visit_date)} />
        {item.interval_days ? <Row label="Interval" value={`${item.interval_days} days`} /> : null}
        {item.linked_appointment ? <Row label="Appointment date" value={formatClinicDate(item.linked_appointment.date)} /> : null}
        {item.linked_appointment?.time ? <Row label="Appointment time" value={formatClinicTime(item.linked_appointment.time)} /> : null}
        {item.close_reason ? <Row label="Closed" value={humanize(item.close_reason)} /> : null}
      </View>

      {item.status === 'OPEN' ? (
        <>
          <AppButton
            label="Book appointment"
            onPress={() => router.push({ pathname: '/assistant/followups/book', params: { followupId: item.followup_id } })}
          />
          {reminderQuery.data?.items[0] ? (
            <AppButton label="Send WhatsApp reminder" tone="secondary" onPress={() => router.push({ pathname: '/assistant/reminders/preview', params: { reminderId: reminderQuery.data!.items[0].reminder_id } })} />
          ) : null}
          <AppButton label="Close follow-up" tone="danger" onPress={() => setShowClose((v) => !v)} />
        </>
      ) : null}
      {item.status === 'BOOKED' && item.linked_appointment ? (
        <AppButton label="Open appointment" onPress={() => router.push({ pathname: '/assistant/appointments/[appointmentId]', params: { appointmentId: item.linked_appointment!.appointment_id } })} />
      ) : null}

      {showClose ? (
        <View style={styles.card}>
          {['PATIENT_DECLINED', 'NO_LONGER_REQUIRED', 'CONTACTED', 'OTHER'].map((value) => (
            <AppButton key={value} label={humanize(value)} tone={reason === value ? 'primary' : 'secondary'} onPress={() => setReason(value)} />
          ))}
          {reason === 'OTHER' ? <KeyboardSafeTextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Reason" /> : null}
          {closeState.error ? <Text style={styles.error}>{apiError(closeState.error)?.message ?? 'Unable to close follow-up.'}</Text> : null}
          <AppButton label="Confirm close" tone="danger" loading={closeState.isLoading} disabled={reason === 'OTHER' && note.trim().length < 2} onPress={() => void close()} />
        </View>
      ) : null}
    </KeyboardSafeFormScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  status: { fontWeight: '900' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted },
  value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.background },
  error: { color: colors.danger },
});
