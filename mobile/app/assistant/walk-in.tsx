import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';

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
import { BackButton } from '@/components/BackButton';
import { newIdempotencyKey } from '@/features/appointments/idempotency';
import type { Patient } from '@/features/patients/types';
import { colors, radius, spacing } from '@/theme/tokens';

export default function WalkInScreen() {
  const router = useRouter();
  const navigation = useNavigation();
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
  const [appointmentType, setAppointmentType] = useState<'REGULAR' | 'FOLLOW_UP'>('REGULAR');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [adjustFee, setAdjustFee] = useState(false);
  const [adjustedAmount, setAdjustedAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');

  useEffect(() => {
    const unsub = navigation.addListener('blur', () => {
      if (!initialPatientId) {
        setPatient(null);
        setQuery('');
      }
      setOverrideEnabled(false);
      setOverrideReason('');
      setAdjustFee(false);
      setAdjustReason('');
    });
    return unsub;
  }, [navigation, initialPatientId]);

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
  const isOwner = Boolean(me.data?.roles.includes('OWNER_ADMIN'));
  const assistantCanAdjust = Boolean(fee.data?.assistant_adjustment_allowed);
  const canAdjust = isOwner || assistantCanAdjust;
  const suggestedFee = useMemo(() => {
    if (!fee.data) return '';
    return String(appointmentType === 'REGULAR' ? fee.data.regular_fee : fee.data.followup_fee);
  }, [appointmentType, fee.data]);
  const clinicClock = clinicTime.data?.clinic_now?.slice(11, 16) ?? '';

  const activeSession = (availability.data?.sessions && clinicClock)
    ? (availability.data.sessions.find(session =>
        session.start_time.slice(0, 5) <= clinicClock && clinicClock < session.end_time.slice(0, 5)
      ) ?? null)
    : null;

  useEffect(() => {
    setOverrideEnabled(false);
    setOverrideReason('');
  }, [doctorId, clinicDate]);
  useEffect(() => {
    setAdjustedAmount(suggestedFee);
  }, [suggestedFee, appointmentType]);

  async function submit() {
    if (!patient || !doctorId || !activeSession) return;
    try {
      const result = await addWalkIn({
        idempotencyKey,
        body: {
          patient_id: patient.patient_id,
          doctor_id: doctorId,
          session_definition_id: activeSession.session_definition_id,
          appointment_type: appointmentType,
          ...(adjustFee ? { fee_adjustment: { amount: adjustedAmount, reason: adjustReason.trim() } } : {}),
          ...(overrideEnabled ? { capacity_override: { enabled: true as const, reason: overrideReason.trim() } } : {}),
        },
      }).unwrap();
      router.replace(`/assistant/appointments/${result.appointment.appointment_id}`);
    } catch {
      // Stable API error shown below.
    }
  }

  const sessionFull = activeSession ? activeSession.remaining_capacity <= 0 : false;
  const blocked = activeSession?.status === 'BLOCKED';
  const overrideRequired = sessionFull;
  const canSubmitOverride = !overrideRequired || (isOwner && overrideEnabled && overrideReason.trim().length >= 2);
  const adjustmentValid = !adjustFee || (/^\d+(\.\d{1,2})?$/.test(adjustedAmount) && adjustReason.trim().length >= 2);

  return (
    <KeyboardSafeFormScreen>
      <QueryState query={clinicTime} label="clinic date" />
      <QueryState query={availability} label="availability" />
      <BackButton />
      <Text style={styles.title}>Add Walk-in</Text>
      <Text style={styles.subtitle}>Create the appointment and check the patient in as one transaction.</Text>

      {!patient ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Patient</Text>
          <KeyboardSafeTextInput value={query} onChangeText={setQuery} placeholder="Search mobile, name or patient ID" style={styles.input} />
          <QueryState query={search} label="patients" />
          {search.data?.items.map((item) => (
            <Pressable key={item.patient_id} style={styles.patientRow} onPress={() => setPatient(item)}>
              <Text style={styles.patientName}>{item.full_name}</Text>
              <Text style={styles.subtitle}>{item.patient_code} · {item.mobile_number}</Text>
            </Pressable>
          ))}
          {query.trim().length >= 2 && !search.isFetching && !search.isError && search.data?.items.length === 0 ? (
            <AppButton label="Register New Patient" tone="secondary" onPress={() => router.push('/assistant/patients/new')} />
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

      {availability.isSuccess && !availability.isFetching && !availability.isError && !activeSession ? (
        <Text style={styles.subtitle}>
          No active clinic session right now.{"\n\n"}Walk-ins can only be added during an active clinic session.
        </Text>
      ) : null}
      {activeSession ? (
        <View style={[styles.card, styles.cardSelected, activeSession.status === 'BLOCKED' && styles.disabled]}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{activeSession.name}</Text>
              <Text style={styles.subtitle}>{activeSession.start_time.slice(0, 5)}–{activeSession.end_time.slice(0, 5)} · {activeSession.used_capacity} / {activeSession.maximum_capacity} capacity used</Text>
            </View>
            <Text style={activeSession.status === 'BLOCKED' ? styles.warning : (activeSession.remaining_capacity > 0 ? styles.success : styles.warning)}>
              {activeSession.status === 'BLOCKED' ? 'BLOCKED' : (activeSession.remaining_capacity > 0 ? 'AVAILABLE' : 'FULL')}
            </Text>
          </View>
        </View>
      ) : null}

      {activeSession && sessionFull && isOwner && !blocked ? (
        <View style={styles.card}>
          <Pressable onPress={() => setOverrideEnabled((value) => !value)}>
            <Text style={styles.cardTitle}>{overrideEnabled ? '✓ ' : ''}Add Extra Walk-in</Text>
            <Text style={styles.subtitle}>The selected session is full. Owner override requires a reason.</Text>
          </Pressable>
          {overrideEnabled ? <KeyboardSafeTextInput value={overrideReason} onChangeText={setOverrideReason} placeholder="Override reason" style={styles.input} /> : null}
        </View>
      ) : null}
      {activeSession && sessionFull && !isOwner ? <Text style={styles.warning}>This session is full. Ask the Owner/Doctor before adding another patient.</Text> : null}

      <View style={styles.feeCard}>
        <View>
          <Text style={styles.label}>Fee</Text>
          <Text style={styles.fee}>₹{adjustFee ? adjustedAmount : suggestedFee || '—'}</Text>
        </View>
        {canAdjust ? <AppButton label={adjustFee ? 'Use Normal Fee' : 'Adjust Fee'} tone="secondary" onPress={() => setAdjustFee((value) => !value)} /> : null}
      </View>
      {adjustFee ? (
        <View style={styles.card}>
          <KeyboardSafeTextInput value={adjustedAmount} onChangeText={setAdjustedAmount} keyboardType="decimal-pad" placeholder="Adjusted amount" style={styles.input} />
          <KeyboardSafeTextInput value={adjustReason} onChangeText={setAdjustReason} placeholder="Required reason" style={styles.input} />
        </View>
      ) : null}

      {(() => {
        const activeErr = apiError(addState.error);
        if (!activeErr) return null;
        if (activeErr.code === 'APPOINTMENT_DUPLICATE_ACTIVE') {
          const details = activeErr.details as {
            appointment_id?: string;
            date?: string;
            time?: string | null;
            status?: string;
            appointment_type?: string;
          } | undefined;
          return (
            <View style={styles.duplicateCard}>
              <Text style={styles.duplicateTitle}>Active Appointment Conflict</Text>
              <Text style={styles.duplicateText}>
                {patient?.full_name ?? 'This patient'} already has an active {String(details?.appointment_type ?? '').replace('_', ' ').toLowerCase()} appointment with {doctors.data?.find((d) => d.doctor_id === doctorId)?.display_name ?? 'this doctor'} today.
              </Text>
              <View style={styles.duplicateMeta}>
                {details?.time ? <Text style={styles.duplicateMetaText}>Time: {String(details.time).slice(0, 5)}</Text> : null}
                <Text style={styles.duplicateMetaText}>Status: {String(details?.status ?? '')}</Text>
              </View>
              {details?.appointment_id ? (
                <AppButton
                  label="View Existing Appointment"
                  onPress={() =>
                    router.push({
                      pathname: '/assistant/appointments/[appointmentId]',
                      params: { appointmentId: String(details.appointment_id) },
                    })
                  }
                />
              ) : null}
            </View>
          );
        }
        return <Text style={styles.error}>{activeErr.message ?? 'Unable to add walk-in.'}</Text>;
      })()}
      <AppButton
        label="Add & Check In"
        loading={addState.isLoading}
        disabled={!patient || !doctorId || !activeSession || blocked || !canSubmitOverride || !adjustmentValid}
        onPress={() => void submit()}
      />
    </KeyboardSafeFormScreen>
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
  duplicateCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  duplicateTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  duplicateText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  duplicateMeta: { flexDirection: 'row', gap: spacing.md, marginVertical: spacing.xs },
  duplicateMetaText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
});

