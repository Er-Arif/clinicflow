import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useCreateAppointmentMessageMutation, useGetAppointmentQuery } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function AppointmentBookedScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ appointmentId: string }>();
  const appointmentId = String(params.appointmentId ?? '');
  const appointment = useGetAppointmentQuery(appointmentId, { skip: !appointmentId });
  const [createMessage, messageState] = useCreateAppointmentMessageMutation();

  async function sendConfirmation() {
    try {
      const prepared = await createMessage({ appointmentId, messageType: 'APPOINTMENT_CONFIRMATION' }).unwrap();
      router.push({ pathname: '/(assistant)/reminders/preview', params: { reminderId: prepared.reminder.reminder_id } });
    } catch {
      // Stable API error shown below.
    }
  }

  if (appointment.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!appointment.data) return <AppScreen><Text style={styles.title}>Appointment booked</Text></AppScreen>;

  return (
    <AppScreen>
      <Text style={styles.success}>✓ Appointment Booked</Text>
      <View style={styles.card}>
        <Text style={styles.name}>{appointment.data.patient.full_name}</Text>
        <Text style={styles.meta}>{appointment.data.session.date} · {appointment.data.appointment_time?.slice(0, 5)}</Text>
        <Text style={styles.meta}>{appointment.data.doctor.display_name}</Text>
        <Text style={styles.meta}>₹{appointment.data.effective_fee}</Text>
      </View>
      {appointment.data.reminder_eligible ? <Text style={styles.note}>A one-day-before reminder has been created.</Text> : <Text style={styles.note}>No separate reminder is scheduled for bookings within 24 hours.</Text>}
      {messageState.error ? <Text style={styles.error}>{apiError(messageState.error)?.message ?? 'Unable to prepare confirmation.'}</Text> : null}
      <AppButton label="Send WhatsApp Confirmation" loading={messageState.isLoading} onPress={() => void sendConfirmation()} />
      <AppButton label="View Appointment" onPress={() => router.replace(`/(assistant)/appointments/${appointmentId}`)} />
      <AppButton label="Done" tone="secondary" onPress={() => router.replace('/(assistant)/appointments')} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  success: { fontSize: 24, fontWeight: '900', color: colors.success },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  name: { color: colors.text, fontWeight: '800', fontSize: 20 },
  meta: { color: colors.muted, fontSize: 16 },
  note: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger },
});
