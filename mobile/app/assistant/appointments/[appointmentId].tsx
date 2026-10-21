import { formatClinicDate, formatClinicTime } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useCancelAppointmentMutation, useCheckInAppointmentMutation, useClinicTimeQuery, useCreateAppointmentMessageMutation, useGetAppointmentQuery, useGetPatientQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { AppointmentCancellationModal } from '@/features/appointments/AppointmentCancellationModal';
import { useIntentIdempotencyKey } from '@/features/appointments/idempotency';
import { colors, radius, spacing } from '@/theme/tokens';

function humanize(value?: string | null) { if (!value) return ''; return value.toLowerCase().replaceAll('_', ' ').replace(/^\w/, char => char.toUpperCase()); }

export default function AppointmentDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ appointmentId: string }>();
  const appointmentId = String(params.appointmentId ?? '');
  const appointment = useGetAppointmentQuery(appointmentId, { skip: !appointmentId });
  const patientId = appointment.data?.patient.patient_id ?? '';
  const patient = useGetPatientQuery(patientId, { skip: !patientId });
  const clinicTime = useClinicTimeQuery();
  const [checkIn, checkInState] = useCheckInAppointmentMutation();
  const checkInRequest = useIntentIdempotencyKey('checkin', appointmentId);
  const [cancelAppointment, cancelState] = useCancelAppointmentMutation();
  const [createMessage, messageState] = useCreateAppointmentMessageMutation();
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('PATIENT_CANCELLED');
  const [note, setNote] = useState('');
  const [submittedCancelIntent, setSubmittedCancelIntent] = useState<string | null>(null);
  const cancelIntent = JSON.stringify({ appointment_id: appointmentId, reason, note: note || null });

  if (appointment.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!appointment.data) return <AppScreen><BackButton /><Text style={styles.title}>Unable to load appointment</Text><QueryState query={appointment} label="appointment" /></AppScreen>;
  const item = appointment.data;

  async function doCheckIn() {
    try {
      await checkIn({ appointmentId, idempotencyKey: checkInRequest.getKey() }).unwrap();
    } catch {
      // The current request error is rendered below.
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
    } catch {}
  }

  async function cancel() {
    setSubmittedCancelIntent(cancelIntent);
    try {
      await cancelAppointment({ appointmentId, reason, note: note || undefined }).unwrap();
      setShowCancel(false);
    } catch {
      // Stable API error shown in the cancellation sheet.
    }
  }

  const paymentConfirmed = item.payment_status === 'CONFIRMED';
  const paymentCorrectionRequired = item.status === 'CHECKED_IN' && paymentConfirmed;
  const canCancel = (item.status === 'BOOKED' || item.status === 'CHECKED_IN') && !paymentCorrectionRequired;
  const clinicDate = clinicTime.data?.clinic_date ?? '';
  const clinicClockTime = clinicTime.data?.clinic_now?.slice(11, 19) ?? '';
  const noShowAvailable = item.status === 'BOOKED' && Boolean(item.appointment_time) && Boolean(clinicDate) && (
    item.session.date < clinicDate ||
    (item.session.date === clinicDate && Boolean(clinicClockTime) && item.appointment_time! <= clinicClockTime)
  );
  const cancellationReasons = item.status === 'CHECKED_IN'
    ? ['PATIENT_CANCELLED', 'DOCTOR_UNAVAILABLE', 'OTHER']
    : ['PATIENT_CANCELLED', ...(noShowAvailable ? ['NO_SHOW'] : []), 'DOCTOR_UNAVAILABLE', 'OTHER'];
  const checkInError = checkInRequest.resultMatchesIntent ? apiError(checkInState.error) : null;
  const cancelError = submittedCancelIntent === cancelIntent ? apiError(cancelState.error) : null;
  const scheduledForClinicDate = clinicDate === item.session.date;
  const canCheckIn = item.status === 'BOOKED' && scheduledForClinicDate;
  const checkInDateUnavailable = item.status === 'BOOKED' && Boolean(clinicDate) && !scheduledForClinicDate;
  const messageActionRelevant = item.status === 'BOOKED' || (item.status === 'CANCELLED' && item.cancellation_reason !== 'RESCHEDULED');
  const messagingAvailable = patient.data?.reminders_enabled === true;
  const reopensLinkedFollowup = item.linked_followup_status === 'BOOKED' && Boolean(item.linked_followup_id);

  return (
    <AppScreen>
      <QueryState query={appointment} label="appointment" /><BackButton />
      <View style={styles.headingRow}><View style={styles.headingCopy}><Text style={styles.title}>{item.patient.full_name}</Text><Text style={styles.subtitle}>{item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular consultation'}</Text></View>
        <View style={[styles.statusPill, item.status === 'CHECKED_IN' && styles.statusChecked, item.status === 'CANCELLED' && styles.statusCancelled]}><Text style={[styles.statusText, item.status === 'CHECKED_IN' && styles.statusCheckedText, item.status === 'CANCELLED' && styles.statusCancelledText]}>{humanize(item.status)}</Text></View>
      </View>
      <View style={styles.card}>
        <Row label="Date" value={formatClinicDate(item.session.date)} /><Row label="Time" value={item.appointment_time ? formatClinicTime(item.appointment_time) : 'Walk-in'} /><Row label="Doctor" value={item.doctor.display_name} /><Row label="Session" value={item.session.name} /><Row label="Fee" value={`₹${item.effective_fee}`} />
        {item.payment_status ? <Row label="Payment" value={paymentConfirmed ? 'Confirmed' : humanize(item.payment_status)} emphasis={paymentConfirmed ? 'success' : 'warning'} /> : null}
        {item.cancellation_reason ? <Row label="Cancellation" value={humanize(item.cancellation_reason)} /> : null}
      </View>
      {canCheckIn ? <AppButton label="Check in" loading={checkInState.isLoading} onPress={() => void doCheckIn()} /> : null}
      {checkInDateUnavailable ? <Text style={styles.actionNotice}>Check-in available on {formatClinicDate(item.session.date)}.</Text> : null}
      {checkInError ? <Text style={styles.error}>{checkInError.message ?? 'Unable to check in patient.'}</Text> : null}
      {item.status === 'CHECKED_IN' && item.visit_id ? <AppButton label="Complete visit" onPress={() => router.push({ pathname: '/assistant/appointments/complete', params: { appointmentId } })} /> : null}
      <View style={styles.secondaryActions}>
        {item.payment_id && ['PENDING', 'CONFIRMED'].includes(item.payment_status ?? '') ? <AppButton compact style={styles.flexButton} label={paymentConfirmed ? 'View receipt' : 'Collect payment'} tone={paymentConfirmed ? 'secondary' : 'primary'} onPress={() => router.push({ pathname: '/assistant/payments/[paymentId]', params: { paymentId: item.payment_id!, appointmentId, ...(item.visit_id ? { visitId: item.visit_id } : {}) } })} /> : null}
        {(item.status === 'BOOKED' || item.status === 'CHECKED_IN') && !paymentCorrectionRequired ? <AppButton compact style={styles.flexButton} label="Reschedule" tone="secondary" onPress={() => router.push({ pathname: '/assistant/appointments/reschedule', params: { appointmentId } })} /> : null}
      </View>
      {messageActionRelevant && messagingAvailable ? <AppButton compact label={item.status === 'CANCELLED' ? 'Send cancellation' : item.rescheduled_from_appointment_id ? 'Send reschedule' : 'Send confirmation'} tone="secondary" loading={messageState.isLoading} onPress={() => void sendAppointmentMessage()} /> : null}
      {messageState.error ? <Text style={styles.error}>{apiError(messageState.error)?.message ?? 'Unable to prepare message.'}</Text> : null}
      {canCancel ? <AppButton compact label="Cancel appointment" tone="danger" onPress={() => { setSubmittedCancelIntent(null); setShowCancel(true); }} /> : null}
      {showCancel ? (
        <AppointmentCancellationModal
          visible
          patientName={item.patient.full_name}
          appointmentDate={formatClinicDate(item.session.date)}
          appointmentTime={item.appointment_time ? formatClinicTime(item.appointment_time) : 'Walk-in'}
          reasons={cancellationReasons}
          selectedReason={reason}
          note={note}
          reopensLinkedFollowup={reopensLinkedFollowup}
          error={cancelError?.message ?? (cancelError ? 'Unable to cancel appointment.' : null)}
          loading={cancelState.isLoading}
          onReasonChange={setReason}
          onNoteChange={setNote}
          onConfirm={() => void cancel()}
          onClose={() => { setSubmittedCancelIntent(null); setShowCancel(false); }}
        />
      ) : null}
    </AppScreen>
  );
}

function Row({ label, value, emphasis }: { label: string; value: string; emphasis?: 'success' | 'warning' }) { return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={[styles.value, emphasis === 'success' && styles.success, emphasis === 'warning' && styles.warning]}>{value}</Text></View>; }
const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, headingCopy: { flex: 1, gap: 3 }, title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark }, subtitle: { color: colors.muted, fontSize: 13 },
  statusPill: { backgroundColor: colors.softSuccess, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }, statusText: { color: colors.success, fontWeight: '700', fontSize: 11 }, statusChecked: { backgroundColor: colors.softPrimary }, statusCheckedText: { color: colors.primary }, statusCancelled: { backgroundColor: colors.surfaceSoft }, statusCancelledText: { color: colors.muted },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }, label: { color: colors.muted, fontSize: 13 }, value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right', fontSize: 13 }, success: { color: colors.success }, warning: { color: colors.warning }, actionNotice: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  secondaryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, flexButton: { flexGrow: 1, flexBasis: '46%' }, error: { color: colors.danger },
});
