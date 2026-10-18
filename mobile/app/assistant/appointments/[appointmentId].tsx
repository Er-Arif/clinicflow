import { formatClinicDate, formatClinicTime } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useCancelAppointmentMutation, useCheckInAppointmentMutation, useGetAppointmentQuery, useCreateAppointmentMessageMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { newIdempotencyKey } from '@/features/appointments/idempotency';
import { colors, radius, spacing } from '@/theme/tokens';

function humanize(value?: string | null) { if (!value) return ''; return value.toLowerCase().replaceAll('_', ' ').replace(/^\w/, char => char.toUpperCase()); }

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
  if (!appointment.data) return <AppScreen><BackButton /><Text style={styles.title}>Unable to load appointment</Text><QueryState query={appointment} label="appointment" /></AppScreen>;
  const item = appointment.data;

  async function doCheckIn() { try { await checkIn({ appointmentId, idempotencyKey: checkInIdempotencyKey }).unwrap(); } catch {} }
  async function sendAppointmentMessage() {
    const current = appointment.data; if (!current) return;
    const messageType = current.status === 'CANCELLED' ? 'APPOINTMENT_CANCELLED' as const : current.rescheduled_from_appointment_id ? 'APPOINTMENT_RESCHEDULED' as const : 'APPOINTMENT_CONFIRMATION' as const;
    try { const prepared = await createMessage({ appointmentId, messageType }).unwrap(); router.push({ pathname: '/assistant/reminders/preview', params: { reminderId: prepared.reminder.reminder_id } }); } catch {}
  }
  async function cancel() { try { await cancelAppointment({ appointmentId, reason, note: note || undefined }).unwrap(); setShowCancel(false); } catch {} }

  const canCancel = item.status === 'BOOKED' || item.status === 'CHECKED_IN';
  const cancellationReasons = item.status === 'CHECKED_IN' ? ['PATIENT_CANCELLED', 'DOCTOR_UNAVAILABLE', 'OTHER'] : ['PATIENT_CANCELLED', 'NO_SHOW', 'DOCTOR_UNAVAILABLE', 'OTHER'];
  const paymentConfirmed = item.payment_status === 'CONFIRMED';

  return (
    <KeyboardSafeFormScreen>
      <QueryState query={appointment} label="appointment" /><BackButton />
      <View style={styles.headingRow}><View style={styles.headingCopy}><Text style={styles.title}>{item.patient.full_name}</Text><Text style={styles.subtitle}>{item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular consultation'}</Text></View>
        <View style={[styles.statusPill, item.status === 'CHECKED_IN' && styles.statusChecked, item.status === 'CANCELLED' && styles.statusCancelled]}><Text style={[styles.statusText, item.status === 'CHECKED_IN' && styles.statusCheckedText, item.status === 'CANCELLED' && styles.statusCancelledText]}>{humanize(item.status)}</Text></View>
      </View>
      <View style={styles.card}>
        <Row label="Date" value={formatClinicDate(item.session.date)} /><Row label="Time" value={item.appointment_time ? formatClinicTime(item.appointment_time) : 'Walk-in'} /><Row label="Doctor" value={item.doctor.display_name} /><Row label="Session" value={item.session.name} /><Row label="Fee" value={`₹${item.effective_fee}`} />
        {item.payment_status ? <Row label="Payment" value={paymentConfirmed ? 'Confirmed' : humanize(item.payment_status)} emphasis={paymentConfirmed ? 'success' : 'warning'} /> : null}
        {item.cancellation_reason ? <Row label="Cancellation" value={humanize(item.cancellation_reason)} /> : null}
      </View>
      {item.status === 'BOOKED' ? <AppButton label="Check In" loading={checkInState.isLoading} onPress={() => void doCheckIn()} /> : null}
      {checkInState.error ? <Text style={styles.error}>{apiError(checkInState.error)?.message ?? 'Unable to check in patient.'}</Text> : null}
      {item.status === 'CHECKED_IN' && item.visit_id ? <AppButton label="Complete Visit" onPress={() => router.push({ pathname: '/assistant/appointments/complete', params: { appointmentId } })} /> : null}
      <View style={styles.secondaryActions}>
        {item.payment_id && ['PENDING', 'CONFIRMED'].includes(item.payment_status ?? '') ? <AppButton compact style={styles.flexButton} label={paymentConfirmed ? 'View Receipt' : 'Collect Payment'} tone={paymentConfirmed ? 'secondary' : 'primary'} onPress={() => router.push({ pathname: '/assistant/payments/[paymentId]', params: { paymentId: item.payment_id!, appointmentId, ...(item.visit_id ? { visitId: item.visit_id } : {}) } })} /> : null}
        {item.status === 'BOOKED' || item.status === 'CHECKED_IN' ? <AppButton compact style={styles.flexButton} label="Reschedule" tone="secondary" onPress={() => router.push({ pathname: '/assistant/appointments/reschedule', params: { appointmentId } })} /> : null}
      </View>
      {(item.status === 'BOOKED' || (item.status === 'CANCELLED' && item.cancellation_reason !== 'RESCHEDULED')) ? <AppButton compact label={item.status === 'CANCELLED' ? 'Send Cancellation' : item.rescheduled_from_appointment_id ? 'Send Reschedule' : 'Send Confirmation'} tone="secondary" loading={messageState.isLoading} onPress={() => void sendAppointmentMessage()} /> : null}
      {messageState.error ? <Text style={styles.error}>{apiError(messageState.error)?.message ?? 'Unable to prepare message.'}</Text> : null}
      {canCancel ? <AppButton compact label={showCancel ? 'Hide cancellation' : 'Cancel Appointment'} tone="danger" onPress={() => setShowCancel(value => !value)} /> : null}
      {showCancel ? <View style={styles.correctionCard}><Text style={styles.cardTitle}>Cancellation</Text><View style={styles.reasonGrid}>{cancellationReasons.map(value => <AppButton key={value} compact label={humanize(value)} tone={reason === value ? 'primary' : 'secondary'} onPress={() => setReason(value)} style={styles.reasonButton} />)}</View>{reason === 'OTHER' ? <KeyboardSafeTextInput value={note} onChangeText={setNote} placeholder="Reason" style={styles.input} /> : null}{cancelState.error ? <Text style={styles.error}>{apiError(cancelState.error)?.message ?? 'Unable to cancel appointment.'}</Text> : null}<AppButton label="Confirm Cancellation" tone="danger" loading={cancelState.isLoading} disabled={reason === 'OTHER' && note.trim().length < 2} onPress={() => void cancel()} /></View> : null}
    </KeyboardSafeFormScreen>
  );
}
function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: 'success' | 'warning' }) { return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={[styles.value, emphasis === 'success' && styles.success, emphasis === 'warning' && styles.warning]}>{value}</Text></View>; }
const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, headingCopy: { flex: 1, gap: 3 }, title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark }, subtitle: { color: colors.muted, fontSize: 13 },
  statusPill: { backgroundColor: colors.softSuccess, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }, statusText: { color: colors.success, fontWeight: '700', fontSize: 11 }, statusChecked: { backgroundColor: colors.softPrimary }, statusCheckedText: { color: colors.primary }, statusCancelled: { backgroundColor: colors.surfaceSoft }, statusCancelledText: { color: colors.muted },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md }, correctionCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#F0C5C5', borderRadius: radius.lg, padding: spacing.md, gap: spacing.md }, cardTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }, label: { color: colors.muted, fontSize: 13 }, value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right', fontSize: 13 }, success: { color: colors.success }, warning: { color: colors.warning },
  secondaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, flexButton: { flexGrow: 1, flexBasis: '46%' }, reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, reasonButton: { flexGrow: 1, flexBasis: '46%' }, input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.background }, error: { color: colors.danger },
});
