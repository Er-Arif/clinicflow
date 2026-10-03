import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useCreateAppointmentMutation, useGetCurrentFeeQuery, useGetPatientQuery, useListDoctorsQuery, useMeQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { newIdempotencyKey } from '@/features/appointments/idempotency';
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
  const [idempotencyKey] = useState(() => newIdempotencyKey('book'));
  const [adjustFee, setAdjustFee] = useState(false);
  const [adjustedAmount, setAdjustedAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const doctor = doctors.data?.find((item) => item.doctor_id === params.doctorId);
  const appointmentType = params.appointmentType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'REGULAR';
  const canAdjustFee = Boolean(me.data?.roles.includes('OWNER_ADMIN') || fee.data?.assistant_adjustment_allowed);
  const feeAmount = useMemo(
    () => appointmentType === 'REGULAR' ? fee.data?.regular_fee : fee.data?.followup_fee,
    [appointmentType, fee.data],
  );

  if (patient.isLoading || doctors.isLoading || fee.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;

  async function confirm() {
    try {
      const result = await createAppointment({
        idempotencyKey,
        body: {
          patient_id: patientId,
          doctor_id: String(params.doctorId),
          session_definition_id: String(params.sessionDefinitionId),
          appointment_date: String(params.appointmentDate),
          appointment_time: String(params.appointmentTime),
          appointment_type: appointmentType,
          ...(adjustFee
            ? { fee_adjustment: { amount: adjustedAmount, reason: adjustmentReason } }
            : {}),
          ...(params.overrideEnabled === '1'
            ? { capacity_override: { enabled: true as const, reason: String(params.overrideReason ?? '') } }
            : {}),
        },
      }).unwrap();
      router.replace({ pathname: '/(assistant)/appointments/booked', params: { appointmentId: result.appointment_id } });
    } catch {
      // RTK Query state renders the stable backend error below. The same key is kept for retry.
    }
  }

  return (
    <AppScreen>
      <Text style={styles.title}>Review Appointment</Text>
      <View style={styles.card}>
        <Row label="Patient" value={patient.data?.full_name ?? '—'} />
        <Row label="Doctor" value={doctor?.display_name ?? '—'} />
        <Row label="Date" value={String(params.appointmentDate ?? '—')} />
        <Row label="Time" value={String(params.appointmentTime ?? '').slice(0, 5)} />
        <Row label="Type" value={appointmentType === 'REGULAR' ? 'Regular Consultation' : 'Follow-up'} />
        <Row label="Fee" value={`₹${adjustFee ? adjustedAmount || feeAmount || '—' : feeAmount ?? '—'}`} />
        {params.overrideEnabled === '1' ? <Row label="Override" value={String(params.overrideReason)} /> : null}
      </View>
      {canAdjustFee ? (
        <View style={styles.card}>
          <Pressable onPress={() => { setAdjustFee((value) => !value); if (!adjustedAmount && feeAmount != null) setAdjustedAmount(String(feeAmount)); }}>
            <Text style={styles.adjustTitle}>{adjustFee ? '✓ ' : ''}Adjust fee</Text>
            <Text style={styles.helper}>Requires a reason and is preserved in fee-adjustment history.</Text>
          </Pressable>
          {adjustFee ? (<>
            <TextInput value={adjustedAmount} onChangeText={setAdjustedAmount} keyboardType="decimal-pad" placeholder="Amount" style={styles.input} />
            <TextInput value={adjustmentReason} onChangeText={setAdjustmentReason} placeholder="Required reason" style={styles.input} />
          </>) : null}
        </View>
      ) : null}
      {createState.error ? <Text style={styles.error}>{apiError(createState.error)?.message ?? 'Unable to book appointment.'}</Text> : null}
      <AppButton label="Book Appointment" loading={createState.isLoading} disabled={adjustFee && (!adjustedAmount || adjustmentReason.trim().length < 2)} onPress={() => void confirm()} />
      <AppButton label="Edit" tone="secondary" onPress={() => router.back()} />
    </AppScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted },
  value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right' },
  error: { color: colors.danger },
  adjustTitle: { color: colors.text, fontWeight: '800' },
  helper: { color: colors.muted, lineHeight: 20 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.background },
});
