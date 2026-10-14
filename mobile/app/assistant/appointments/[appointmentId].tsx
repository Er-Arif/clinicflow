import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import {
  useCancelAppointmentMutation,
  useCheckInAppointmentMutation,
  useGetAppointmentQuery,
  useCreateAppointmentMessageMutation,
} from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { newIdempotencyKey } from '@/features/appointments/idempotency';
import { colors, radius, spacing } from '@/theme/tokens';

export default function AppointmentDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ appointmentId: string }>();
  const appointmentId = String(params.appointmentId ?? '');
  const appointment = useGetAppointmentQuery(appointmentId, { skip: !appointmentId });
  const [checkIn, checkInState] = useCheckInAppointmentMutation();
  const [checkInIdempotencyKey] = useState(() => newIdempotencyKey('checkin'));
  const [cancelAppointment, cancelState] = useCancelAppointmentMutation();
  const [createMessage, messageState] = useCreateAppointmentMessageMutation();
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('PATIENT_CANCELLED');
  const [note, setNote] = useState('');

  if (appointment.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!appointment.data) {
    return (
      <AppScreen>
        <BackButton />
        <Text style={styles.title}>Appointment not found</Text>
      </AppScreen>
    );
  }
  const item = appointment.data;

  async function doCheckIn() {
    try {
      await checkIn({ appointmentId, idempotencyKey: checkInIdempotencyKey }).unwrap();
    } catch {
      // Stable API error displayed below.
    }
  }


  async function sendAppointmentMessage() {
    const current = appointment.data;
    if (!current) return;
    const messageType = current.status === 'CANCELLED'
      ? 'APPOINTMENT_CANCELLED' as const
      : current.rescheduled_from_appointment_id
        ? 'APPOINTMENT_RESCHEDULED' as const
        : 'APPOINTMENT_CONFIRMATION' as const;
    try {
      const prepared = await createMessage({ appointmentId, messageType }).unwrap();
      router.push({ pathname: '/assistant/reminders/preview', params: { reminderId: prepared.reminder.reminder_id } });
    } catch {
      // Stable API error displayed below.
    }
  }

  async function cancel() {
    try {
      await cancelAppointment({ appointmentId, reason, note: note || undefined }).unwrap();
      setShowCancel(false);
    } catch {
      // Stable API error displayed below.
    }
  }

  const canCancel = item.status === 'BOOKED' || item.status === 'CHECKED_IN';
  const cancellationReasons = item.status === 'CHECKED_IN'
    ? ['PATIENT_CANCELLED', 'DOCTOR_UNAVAILABLE', 'OTHER']
    : ['PATIENT_CANCELLED', 'NO_SHOW', 'DOCTOR_UNAVAILABLE', 'OTHER'];

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <Text style={styles.title}>{item.patient.full_name}</Text>
      <Text style={styles.status}>{item.status.replace('_', ' ')}</Text>
      <View style={styles.card}>
        <Row label="Date" value={item.session.date} />
        <Row label="Time" value={item.appointment_time?.slice(0, 5) ?? 'Walk-in'} />
        <Row label="Session" value={item.session.name} />
        <Row label="Doctor" value={item.doctor.display_name} />
        <Row label="Type" value={item.appointment_type.replace('_', ' ')} />
        <Row label="Fee" value={`₹${item.effective_fee}`} />
        <Row label="Source" value={item.booking_source} />
        {item.visit_status ? <Row label="Visit" value={item.visit_status} /> : null}
        {item.payment_status ? <Row label="Payment" value={item.payment_status} /> : null}
        {item.linked_followup_status ? <Row label="Linked follow-up" value={item.linked_followup_status} /> : null}
        {item.cancellation_reason ? <Row label="Cancellation" value={item.cancellation_reason.replaceAll('_', ' ')} /> : null}
      </View>

      {item.status === 'BOOKED' ? (
        <AppButton label="Check In" loading={checkInState.isLoading} onPress={() => void doCheckIn()} />
      ) : null}
      {checkInState.error ? (
        <Text style={styles.error}>{apiError(checkInState.error)?.message ?? 'Unable to check in patient.'}</Text>
      ) : null}

      {item.payment_id && ['PENDING', 'CONFIRMED'].includes(item.payment_status ?? '') ? (
        <AppButton
          label={item.payment_status === 'CONFIRMED' ? 'View Payment / Receipt' : 'Collect Payment'}
          onPress={() => router.push({ pathname: '/assistant/payments/[paymentId]', params: { paymentId: item.payment_id! } })}
        />
      ) : null}

      {item.status === 'CHECKED_IN' && item.visit_id ? (
        <AppButton
          label="Complete Visit"
          onPress={() => router.push({ pathname: '/assistant/appointments/complete', params: { appointmentId } })}
        />
      ) : null}

      {(item.status === 'BOOKED' || (item.status === 'CANCELLED' && item.cancellation_reason !== 'RESCHEDULED')) ? (
        <AppButton
          label={item.status === 'CANCELLED' ? 'Send WhatsApp Cancellation' : item.rescheduled_from_appointment_id ? 'Send WhatsApp Reschedule' : 'Send WhatsApp Confirmation'}
          tone="secondary"
          loading={messageState.isLoading}
          onPress={() => void sendAppointmentMessage()}
        />
      ) : null}
      {messageState.error ? <Text style={styles.error}>{apiError(messageState.error)?.message ?? 'Unable to prepare message.'}</Text> : null}

      {item.status === 'BOOKED' || item.status === 'CHECKED_IN' ? (
        <AppButton
          label="Reschedule"
          tone="secondary"
          onPress={() => router.push({ pathname: '/assistant/appointments/reschedule', params: { appointmentId } })}
        />
      ) : null}

      {canCancel ? (
        <AppButton label="Cancel Appointment" tone="danger" onPress={() => setShowCancel((value) => !value)} />
      ) : null}

      {showCancel ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Cancellation reason</Text>
          <View style={styles.actions}>
            {cancellationReasons.map((value) => (
              <AppButton
                key={value}
                label={value.replaceAll('_', ' ')}
                tone={reason === value ? 'primary' : 'secondary'}
                onPress={() => setReason(value)}
              />
            ))}
          </View>
          {reason === 'OTHER' ? <KeyboardSafeTextInput value={note} onChangeText={setNote} placeholder="Reason" style={styles.input} /> : null}
          {cancelState.error ? <Text style={styles.error}>{apiError(cancelState.error)?.message ?? 'Unable to cancel appointment.'}</Text> : null}
          <AppButton
            label="Confirm Cancellation"
            tone="danger"
            loading={cancelState.isLoading}
            disabled={reason === 'OTHER' && note.trim().length < 2}
            onPress={() => void cancel()}
          />
        </View>
      ) : null}
      <AppButton label="Back to Appointments" tone="secondary" onPress={() => router.replace('/assistant/appointments')} />
    </KeyboardSafeFormScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  status: { color: colors.primary, fontWeight: '900' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  cardTitle: { color: colors.text, fontWeight: '800' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted },
  value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right' },
  actions: { gap: spacing.sm },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.background },
  error: { color: colors.danger },
});
