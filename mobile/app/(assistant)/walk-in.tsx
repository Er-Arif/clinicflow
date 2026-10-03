import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  useAddWalkInMutation,
  useClinicTimeQuery,
  useGetAvailabilityQuery,
  useGetCurrentFeeQuery,
  useGetPatientQuery,
  useListDoctorsQuery,
  useMeQuery,
  useSearchPatientsQuery,
} from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { newIdempotencyKey } from '@/features/appointments/idempotency';
import type { Patient } from '@/features/patients/types';
import { colors, radius, spacing } from '@/theme/tokens';

export default function WalkInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ patientId?: string }>();
  const initialPatientId = String(params.patientId ?? '');
  const initialPatient = useGetPatientQuery(initialPatientId, { skip: !initialPatientId });
  const clinicTime = useClinicTimeQuery();
  const doctors = useListDoctorsQuery();
  const fee = useGetCurrentFeeQuery();
  const me = useMeQuery();
  const [addWalkIn, addState] = useAddWalkInMutation();
  const [idempotencyKey] = useState(() => newIdempotencyKey('walkin'));

  const [query, setQuery] = useState('');
  const search = useSearchPatientsQuery({ q: query.trim() }, { skip: query.trim().length < 2 || Boolean(initialPatientId) });
  const [patient, setPatient] = useState<Patient | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [sessionDefinitionId, setSessionDefinitionId] = useState('');
  const [appointmentType, setAppointmentType] = useState<'REGULAR' | 'FOLLOW_UP'>('REGULAR');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [adjustFee, setAdjustFee] = useState(false);
  const [adjustedAmount, setAdjustedAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  useEffect(() => {
    if (initialPatient.data) setPatient(initialPatient.data);
  }, [initialPatient.data]);
  useEffect(() => {
    if (!doctorId && doctors.data?.[0]?.doctor_id) setDoctorId(doctors.data[0].doctor_id);
  }, [doctorId, doctors.data]);

  const clinicDate = clinicTime.data?.clinic_date ?? '';
  const availability = useGetAvailabilityQuery(
    { doctorId, date: clinicDate },
    { skip: !doctorId || !clinicDate },
  );
  const selectedSession = availability.data?.sessions.find((item) => item.session_definition_id === sessionDefinitionId);
  const isOwner = Boolean(me.data?.roles.includes('OWNER_ADMIN'));
  const assistantCanAdjust = Boolean(fee.data?.assistant_adjustment_allowed);
  const canAdjust = isOwner || assistantCanAdjust;
  const suggestedFee = useMemo(() => {
    if (!fee.data) return '';
    return String(appointmentType === 'REGULAR' ? fee.data.regular_fee : fee.data.followup_fee);
  }, [appointmentType, fee.data]);
  const clinicClock = clinicTime.data?.clinic_now?.slice(11, 16) ?? '';

  useEffect(() => {
    setSessionDefinitionId('');
    setOverrideEnabled(false);
    setOverrideReason('');
  }, [doctorId, clinicDate]);
  useEffect(() => {
    setAdjustedAmount(suggestedFee);
  }, [suggestedFee, appointmentType]);

  async function submit() {
    if (!patient || !doctorId || !sessionDefinitionId) return;
    try {
      const result = await addWalkIn({
        idempotencyKey,
        body: {
          patient_id: patient.patient_id,
          doctor_id: doctorId,
          session_definition_id: sessionDefinitionId,
          appointment_type: appointmentType,
          ...(adjustFee ? { fee_adjustment: { amount: adjustedAmount, reason: adjustReason.trim() } } : {}),
          ...(overrideEnabled ? { capacity_override: { enabled: true as const, reason: overrideReason.trim() } } : {}),
        },
      }).unwrap();
      router.replace(`/(assistant)/appointments/${result.appointment.appointment_id}`);
    } catch {
      // Stable API error shown below.
    }
  }

  const sessionFull = selectedSession ? selectedSession.remaining_capacity <= 0 : false;
  const blocked = selectedSession?.status === 'BLOCKED';
  const overrideRequired = sessionFull;
  const canSubmitOverride = !overrideRequired || (isOwner && overrideEnabled && overrideReason.trim().length >= 2);
  const adjustmentValid = !adjustFee || (/^\d+(\.\d{1,2})?$/.test(adjustedAmount) && adjustReason.trim().length >= 2);

  return (
    <AppScreen>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Add Walk-in</Text>
          <Text style={styles.subtitle}>Create the appointment and check the patient in as one transaction.</Text>
        </View>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      </View>

      {!patient ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Patient</Text>
          <TextInput value={query} onChangeText={setQuery} placeholder="Search mobile, name or patient ID" style={styles.input} />
          {search.isFetching ? <ActivityIndicator /> : null}
          {search.data?.items.map((item) => (
            <Pressable key={item.patient_id} style={styles.patientRow} onPress={() => setPatient(item)}>
              <Text style={styles.patientName}>{item.full_name}</Text>
              <Text style={styles.subtitle}>{item.patient_code} · {item.mobile_number}</Text>
            </Pressable>
          ))}
          {query.trim().length >= 2 && !search.isFetching && search.data?.items.length === 0 ? (
            <AppButton label="Register New Patient" tone="secondary" onPress={() => router.push('/(assistant)/patients/new')} />
          ) : null}
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{patient.full_name}</Text>
              <Text style={styles.subtitle}>{patient.patient_code} · {patient.mobile_number}</Text>
            </View>
            {!initialPatientId ? <Pressable onPress={() => setPatient(null)}><Text style={styles.link}>Change</Text></Pressable> : null}
          </View>
        </View>
      )}

      <Text style={styles.label}>Appointment Type</Text>
      <View style={styles.chips}>
        {(['REGULAR', 'FOLLOW_UP'] as const).map((type) => (
          <Pressable key={type} style={[styles.chip, appointmentType === type && styles.chipActive]} onPress={() => setAppointmentType(type)}>
            <Text style={appointmentType === type ? styles.chipTextActive : styles.chipText}>{type === 'REGULAR' ? 'Regular' : 'Follow-up'}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Doctor</Text>
      <View style={styles.chips}>
        {doctors.data?.map((doctor) => (
          <Pressable key={doctor.doctor_id} style={[styles.chip, doctorId === doctor.doctor_id && styles.chipActive]} onPress={() => setDoctorId(doctor.doctor_id)}>
            <Text style={doctorId === doctor.doctor_id ? styles.chipTextActive : styles.chipText}>{doctor.display_name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Today&apos;s Session</Text>
      <Text style={styles.subtitle}>{clinicDate || 'Loading clinic date…'}{clinicClock ? ` · ${clinicClock}` : ''}</Text>
      {availability.isFetching ? <ActivityIndicator /> : null}
      {availability.data?.sessions.map((session) => {
        const current = clinicClock && session.start_time.slice(0, 5) <= clinicClock && clinicClock < session.end_time.slice(0, 5);
        const selected = session.session_definition_id === sessionDefinitionId;
        return (
          <Pressable
            key={session.session_definition_id}
            disabled={session.status === 'BLOCKED'}
            onPress={() => {
              setSessionDefinitionId(session.session_definition_id);
              setOverrideEnabled(false);
              setOverrideReason('');
            }}
            style={[styles.card, selected && styles.cardSelected, session.status === 'BLOCKED' && styles.disabled]}
          >
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{session.name}{current ? ' · Current' : ''}</Text>
                <Text style={styles.subtitle}>{session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)} · {session.used_capacity}/{session.maximum_capacity} accepted</Text>
              </View>
              <Text style={session.remaining_capacity > 0 ? styles.success : styles.warning}>{session.status === 'BLOCKED' ? 'BLOCKED' : session.remaining_capacity > 0 ? 'AVAILABLE' : 'FULL'}</Text>
            </View>
          </Pressable>
        );
      })}

      {selectedSession && sessionFull && isOwner && !blocked ? (
        <View style={styles.card}>
          <Pressable onPress={() => setOverrideEnabled((value) => !value)}>
            <Text style={styles.cardTitle}>{overrideEnabled ? '✓ ' : ''}Add Extra Walk-in</Text>
            <Text style={styles.subtitle}>The selected session is full. Owner override requires a reason.</Text>
          </Pressable>
          {overrideEnabled ? <TextInput value={overrideReason} onChangeText={setOverrideReason} placeholder="Override reason" style={styles.input} /> : null}
        </View>
      ) : null}
      {selectedSession && sessionFull && !isOwner ? <Text style={styles.warning}>This session is full. Ask the Owner/Doctor before adding another patient.</Text> : null}

      <View style={styles.feeCard}>
        <View>
          <Text style={styles.label}>Fee</Text>
          <Text style={styles.fee}>₹{adjustFee ? adjustedAmount : suggestedFee || '—'}</Text>
        </View>
        {canAdjust ? <AppButton label={adjustFee ? 'Use Normal Fee' : 'Adjust Fee'} tone="secondary" onPress={() => setAdjustFee((value) => !value)} /> : null}
      </View>
      {adjustFee ? (
        <View style={styles.card}>
          <TextInput value={adjustedAmount} onChangeText={setAdjustedAmount} keyboardType="decimal-pad" placeholder="Adjusted amount" style={styles.input} />
          <TextInput value={adjustReason} onChangeText={setAdjustReason} placeholder="Required reason" style={styles.input} />
        </View>
      ) : null}

      {addState.error ? <Text style={styles.error}>{apiError(addState.error)?.message ?? 'Unable to add walk-in.'}</Text> : null}
      <AppButton
        label="Add & Check In"
        loading={addState.isLoading}
        disabled={!patient || !doctorId || !sessionDefinitionId || blocked || !canSubmitOverride || !adjustmentValid}
        onPress={() => void submit()}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '800', paddingTop: 4 },
  label: { color: colors.text, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.softPrimary },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background, paddingHorizontal: 14, color: colors.text },
  patientRow: { borderTopWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm },
  patientName: { color: colors.text, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipActive: { backgroundColor: colors.softPrimary, borderColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: colors.primary, fontWeight: '800' },
  success: { color: colors.success, fontWeight: '800' },
  warning: { color: colors.warning, fontWeight: '800' },
  error: { color: colors.danger, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  feeCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, backgroundColor: colors.softPrimary, borderRadius: radius.md, padding: spacing.md },
  fee: { color: colors.primary, fontSize: 22, fontWeight: '900' },
});
