import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useCloseFollowUpMutation, useGetFollowUpQuery, useListRemindersQuery } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

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
  if (!query.data) return <AppScreen><Text style={styles.title}>Follow-up not found</Text></AppScreen>;
  const item = query.data;

  async function close() {
    try {
      await closeFollowUp({ followupId, reason, note: note || undefined }).unwrap();
      setShowClose(false);
    } catch {
      // Stable API error shown below.
    }
  }

  return (
    <AppScreen>
      <Text style={styles.title}>{item.patient.full_name}</Text>
      <Text style={[styles.status, item.overdue && { color: colors.danger }]}>{item.overdue ? 'OVERDUE' : item.status}</Text>
      <View style={styles.card}>
        <Row label="Due" value={item.due_date} />
        <Row label="Source visit" value={item.source_visit_date} />
        <Row label="Patient ID" value={item.patient.patient_code} />
        {item.interval_days ? <Row label="Interval" value={`${item.interval_days} days`} /> : null}
        {item.linked_appointment ? <Row label="Appointment" value={`${item.linked_appointment.date} ${item.linked_appointment.time?.slice(0, 5) ?? ''}`} /> : null}
        {item.close_reason ? <Row label="Closed" value={item.close_reason.replaceAll('_', ' ')} /> : null}
      </View>

      {item.status === 'OPEN' ? (
        <>
          <AppButton
            label="Book Appointment"
            onPress={() =>
              router.push({
                pathname: '/assistant/appointments/new',
                params: {
                  patientId: item.patient.patient_id,
                  appointmentType: 'FOLLOW_UP',
                  followupId: item.followup_id,
                  dueDate: item.due_date,
                  doctorId: item.doctor_id,
                },
              })
            }
          />
          {reminderQuery.data?.items[0] ? (
            <AppButton label="Send WhatsApp Reminder" tone="secondary" onPress={() => router.push({ pathname: '/assistant/reminders/preview', params: { reminderId: reminderQuery.data!.items[0].reminder_id } })} />
          ) : null}
          <AppButton label="Close Follow-up" tone="danger" onPress={() => setShowClose((v) => !v)} />
        </>
      ) : null}
      {item.status === 'BOOKED' && item.linked_appointment ? (
        <AppButton label="Open Appointment" onPress={() => router.push({ pathname: '/assistant/appointments/[appointmentId]', params: { appointmentId: item.linked_appointment!.appointment_id } })} />
      ) : null}

      {showClose ? (
        <View style={styles.card}>
          {['PATIENT_DECLINED', 'NO_LONGER_REQUIRED', 'CONTACTED', 'OTHER'].map((value) => (
            <AppButton key={value} label={value.replaceAll('_', ' ')} tone={reason === value ? 'primary' : 'secondary'} onPress={() => setReason(value)} />
          ))}
          {reason === 'OTHER' ? <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Reason" /> : null}
          {closeState.error ? <Text style={styles.error}>{apiError(closeState.error)?.message ?? 'Unable to close follow-up.'}</Text> : null}
          <AppButton label="Confirm Close" tone="danger" loading={closeState.isLoading} disabled={reason === 'OTHER' && note.trim().length < 2} onPress={() => void close()} />
        </View>
      ) : null}
      <AppButton label="Back" tone="secondary" onPress={() => router.back()} />
    </AppScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  status: { color: colors.primary, fontWeight: '900' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted },
  value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.background },
  error: { color: colors.danger },
});
