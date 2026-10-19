import { formatClinicDate, formatClinicTime } from '@/utils/dates';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useCreateAppointmentMutation, useBookFollowUpMutation, useGetCurrentFeeQuery, useGetPatientQuery, useListDoctorsQuery, useMeQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { useIntentIdempotencyKey } from '@/features/appointments/idempotency';
import { colors, radius, spacing } from '@/theme/tokens';

export default function AppointmentReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<Record<string, string>>();
  const patientId = String(params.patientId ?? '');
  const patient = useGetPatientQuery(patientId, { skip: !patientId });
  const doctors = useListDoctorsQuery();
  const fee = useGetCurrentFeeQuery();
  const me = useMeQuery();
  const [createAppointment, createState] = useCreateAppointmentMutation();
  const [bookFollowup, bookState] = useBookFollowUpMutation();
  const [adjustFee, setAdjustFee] = useState(false);
  const [adjustedAmount, setAdjustedAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const doctor = doctors.data?.find(item => item.doctor_id === params.doctorId);
  const appointmentType = params.appointmentType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'REGULAR';
  const followupId = params.followupId;
  const canAdjustFee = Boolean(me.data?.roles.includes('OWNER_ADMIN') || fee.data?.assistant_adjustment_allowed);
  const feeAmount = useMemo(() => appointmentType === 'REGULAR' ? fee.data?.regular_fee : fee.data?.followup_fee, [appointmentType, fee.data]);
  const bookingIntent = JSON.stringify({
    mode: followupId ? 'followup' : 'appointment',
    followup_id: followupId ?? null,
    patient_id: patientId,
    doctor_id: String(params.doctorId ?? ''),
    session_definition_id: String(params.sessionDefinitionId ?? ''),
    appointment_date: String(params.appointmentDate ?? ''),
    appointment_time: String(params.appointmentTime ?? ''),
    appointment_type: appointmentType,
    fee_adjustment: !followupId && adjustFee
      ? { amount: adjustedAmount, reason: adjustmentReason }
      : null,
    capacity_override: params.overrideEnabled === '1'
      ? { enabled: true, reason: String(params.overrideReason ?? '') }
      : null,
  });
  const bookingRequest = useIntentIdempotencyKey('book', bookingIntent);

  if (patient.isLoading || doctors.isLoading || fee.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;

  async function confirm() {
    try {
      const idempotencyKey = bookingRequest.getKey();
      const body = {
        patient_id: patientId,
        doctor_id: String(params.doctorId),
        session_definition_id: String(params.sessionDefinitionId),
        appointment_date: String(params.appointmentDate),
        appointment_time: String(params.appointmentTime),
        appointment_type: appointmentType,
        ...(adjustFee ? { fee_adjustment: { amount: adjustedAmount, reason: adjustmentReason } } : {}),
        ...(params.overrideEnabled === '1' ? { capacity_override: { enabled: true as const, reason: String(params.overrideReason ?? '') } } : {}),
      } as const;

      let result;
      if (followupId) {
        const bookRes = await bookFollowup({
          followupId,
          idempotencyKey,
          body: {
            session_definition_id: String(params.sessionDefinitionId),
            appointment_date: String(params.appointmentDate),
            appointment_time: String(params.appointmentTime),
            ...(params.overrideEnabled === '1' ? { capacity_override: { enabled: true as const, reason: String(params.overrideReason ?? '') } } : {}),
          },
        }).unwrap();
        result = bookRes.appointment;
      } else {
        result = await createAppointment({ idempotencyKey, body }).unwrap();
      }
      router.replace({ pathname: '/assistant/appointments/booked', params: { appointmentId: result.appointment_id } });
    } catch {
      // The current request error is rendered below.
    }
  }

  const activeError = bookingRequest.resultMatchesIntent ? apiError(createState.error || bookState.error) : null;
  const isDuplicateActive = activeError?.code === 'APPOINTMENT_DUPLICATE_ACTIVE';
  const duplicateDetails = activeError?.details as { appointment_id?: string; date?: string; time?: string | null; status?: string; appointment_type?: string } | undefined;

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <View style={styles.header}><Text style={styles.title}>Review appointment</Text><Text style={styles.subtitle}>Confirm the booking details</Text></View>
      <View style={styles.card}>
        <Row label="Patient" value={patient.data?.full_name ?? '—'} />
        <Row label="Doctor" value={doctor?.display_name ?? '—'} />
        <Row label="Date" value={formatClinicDate(String(params.appointmentDate ?? ''))} />
        <Row label="Time" value={formatClinicTime(String(params.appointmentTime ?? ''))} />
        <Row label="Type" value={appointmentType === 'REGULAR' ? 'Regular consultation' : 'Follow-up'} />
        <Row label="Fee" value={`₹${adjustFee ? adjustedAmount || feeAmount || '—' : feeAmount ?? '—'}`} />
      </View>

      {canAdjustFee ? (
        <View style={styles.card}>
          <Pressable onPress={() => { setAdjustFee(value => !value); if (!adjustedAmount && feeAmount != null) setAdjustedAmount(String(feeAmount)); }}>
            <Text style={styles.cardTitle}>{adjustFee ? '✓ ' : ''}Adjust fee</Text>
          </Pressable>
          {adjustFee ? <>
            <KeyboardSafeTextInput value={adjustedAmount} onChangeText={setAdjustedAmount} keyboardType="decimal-pad" placeholder="Amount" style={styles.input} />
            <KeyboardSafeTextInput value={adjustmentReason} onChangeText={setAdjustmentReason} placeholder="Required reason" style={styles.input} />
          </> : null}
        </View>
      ) : null}

      {isDuplicateActive ? (
        <View style={styles.conflictCard}>
          <Text style={styles.cardTitle}>Active appointment already exists</Text>
          <Text style={styles.subtitle}>{patient.data?.full_name ?? 'This patient'} already has an active appointment with {doctor?.display_name ?? 'this doctor'} on {formatClinicDate(String(duplicateDetails?.date ?? params.appointmentDate))}.</Text>
          {duplicateDetails?.time ? <Text style={styles.conflictMeta}>{formatClinicTime(duplicateDetails.time)}</Text> : null}
          {duplicateDetails?.appointment_id ? <AppButton compact label="View existing appointment" onPress={() => router.push({ pathname: '/assistant/appointments/[appointmentId]', params: { appointmentId: String(duplicateDetails.appointment_id) } })} /> : null}
        </View>
      ) : activeError ? <Text style={styles.error}>{activeError.message ?? 'Unable to book appointment.'}</Text> : null}

      <AppButton label="Book appointment" loading={createState.isLoading || bookState.isLoading} disabled={adjustFee && (!adjustedAmount || adjustmentReason.trim().length < 2)} onPress={() => void confirm()} />
      <AppButton compact label="Edit details" tone="secondary" onPress={() => router.back()} />
    </KeyboardSafeFormScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  header: { gap: 3 },
  title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  cardTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted, fontSize: 13 },
  value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right', fontSize: 13 },
  error: { color: colors.danger },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.background },
  conflictCard: { backgroundColor: colors.softWarning, borderWidth: 1, borderColor: '#F2D49C', borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  conflictMeta: { color: colors.warning, fontSize: 13, fontWeight: '700' },
});
