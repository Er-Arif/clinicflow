import { formatClinicDate, formatClinicTime } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useCloseFollowUpMutation, useGetFollowUpQuery, useListRemindersQuery } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { FollowUpCloseModal } from '@/features/followups/FollowUpCloseModal';
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
      // Stable API error shown in the closure sheet.
    }
  }

  return (
    <AppScreen>
      <QueryState query={query} label="follow-up" />
      <BackButton />
      <Text style={styles.title}>Follow-up details</Text>
      <Text style={[styles.status, { color: statusColor }]}>{item.overdue ? 'Overdue' : humanize(item.status)}</Text>
      <View style={styles.card}>
        <Row label="Patient" value={item.patient.full_name} />
        <Row label="Patient ID" value={item.patient.patient_code} />
        <Row label="Source visit" value={formatClinicDate(item.source_visit_date)} />
        {item.interval_days ? <Row label="Follow-up interval" value={`${item.interval_days} days`} /> : null}
        <Row label="Due" value={formatClinicDate(item.due_date)} />
        {item.linked_appointment ? <Row label="Appointment date" value={formatClinicDate(item.linked_appointment.date)} /> : null}
        {item.linked_appointment?.time ? <Row label="Appointment time" value={formatClinicTime(item.linked_appointment.time)} /> : null}
        {item.close_reason ? <Row label="Closure reason" value={humanize(item.close_reason)} /> : null}
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
          <AppButton label="Close follow-up" tone="danger" onPress={() => setShowClose(true)} />
        </>
      ) : null}
      {item.status === 'BOOKED' && item.linked_appointment ? (
        <AppButton label="Open appointment" onPress={() => router.push({ pathname: '/assistant/appointments/[appointmentId]', params: { appointmentId: item.linked_appointment!.appointment_id } })} />
      ) : null}

      {item.status === 'OPEN' && showClose ? (
        <FollowUpCloseModal
          visible
          patientName={item.patient.full_name}
          dueDate={formatClinicDate(item.due_date)}
          selectedReason={reason}
          note={note}
          error={closeState.error ? apiError(closeState.error)?.message ?? 'Unable to close follow-up.' : null}
          loading={closeState.isLoading}
          onReasonChange={setReason}
          onNoteChange={setNote}
          onConfirm={() => void close()}
          onClose={() => setShowClose(false)}
        />
      ) : null}
    </AppScreen>
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
});
