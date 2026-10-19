import { formatClinicDate } from '@/utils/dates';
import { DatePicker } from '@/components/DatePicker';
import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useBookFollowUpMutation, useClinicTimeQuery, useGetAvailabilityQuery, useGetFollowUpQuery, useMeQuery } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { newIdempotencyKey } from '@/features/appointments/idempotency';
import { colors, radius, spacing } from '@/theme/tokens';

export default function BookFollowUpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ followupId: string }>();
  const followupId = String(params.followupId ?? '');
  const followup = useGetFollowUpQuery(followupId, { skip: !followupId });
  const clinicTime = useClinicTimeQuery();
  const me = useMeQuery();
  const [date, setDate] = useState('');
  const [sessionDefinitionId, setSessionDefinitionId] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [bookFollowUp, bookState] = useBookFollowUpMutation();
  const [idempotencyKey] = useState(() => newIdempotencyKey('followup-book'));

  useEffect(() => {
    if (!date && followup.data && clinicTime.data?.clinic_date) {
      setDate(followup.data.due_date >= clinicTime.data.clinic_date ? followup.data.due_date : clinicTime.data.clinic_date);
    }
  }, [date, followup.data, clinicTime.data?.clinic_date]);

  const availability = useGetAvailabilityQuery(
    { doctorId: followup.data?.doctor_id ?? '', date },
    { skip: !followup.data?.doctor_id || !date },
  );
  const selectedSession = useMemo(
    () => availability.data?.sessions.find((s) => s.session_definition_id === sessionDefinitionId),
    [availability.data?.sessions, sessionDefinitionId],
  );
  const canOverride = me.data?.permissions.includes('appointment.capacity_override') ?? false;

  async function submit() {
    if (!sessionDefinitionId || !appointmentTime) return;
    try {
      const result = await bookFollowUp({
        followupId,
        idempotencyKey,
        body: {
          session_definition_id: sessionDefinitionId,
          appointment_date: date,
          appointment_time: appointmentTime,
          ...(override ? { capacity_override: { enabled: true as const, reason: overrideReason } } : {}),
        },
      }).unwrap();
      router.replace({ pathname: '/assistant/appointments/[appointmentId]', params: { appointmentId: result.appointment.appointment_id } });
    } catch {
      // Stable API error below.
    }
  }

  if (followup.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!followup.data) return <AppScreen><Text style={styles.title}>Unable to load follow-up</Text><QueryState query={followup} label="follow-up" /></AppScreen>;

  return (
    <KeyboardSafeFormScreen>
      <QueryState query={followup} label="follow-up" />
      <QueryState query={clinicTime} label="clinic date" />
      <QueryState query={availability} label="availability" />
      <Text style={styles.title}>Book follow-up</Text>
      <Text style={styles.subtitle}>{followup.data.patient.full_name} · Due {formatClinicDate(followup.data.due_date)}</Text>
      <DatePicker value={date} onChange={(value) => { setDate(value); setSessionDefinitionId(''); setAppointmentTime(''); }} accessibilityLabel="Follow-up appointment date" />

      {availability.data?.sessions.map((session) => (
        <View key={session.session_definition_id} style={styles.card}>
          <Text style={styles.session}>{session.name}</Text>
          <Text style={styles.subtitle}>{session.start_time.slice(0,5)}–{session.end_time.slice(0,5)} · {session.used_capacity}/{session.maximum_capacity} booked {session.status === 'BLOCKED' ? '· Blocked' : ''}</Text>
          <AppButton label={sessionDefinitionId === session.session_definition_id ? 'Selected session' : 'Select session'} tone={sessionDefinitionId === session.session_definition_id ? 'primary' : 'secondary'} disabled={session.status === 'BLOCKED'} onPress={() => { setSessionDefinitionId(session.session_definition_id); setAppointmentTime(''); }} />
        </View>
      ))}
      {selectedSession ? (
        <View style={styles.card}>
          <Text style={styles.session}>Choose time</Text>
          {selectedSession.slots.map((slot) => (
            <AppButton
              key={slot.time}
              label={`${slot.time.slice(0,5)}${slot.available ? '' : ' · Occupied'}`}
              tone={appointmentTime === slot.time ? 'primary' : 'secondary'}
              disabled={!slot.normal_booking_allowed && !canOverride}
              onPress={() => { setAppointmentTime(slot.time); if (!slot.normal_booking_allowed) setOverride(true); else setOverride(false); }}
            />
          ))}
        </View>
      ) : null}
      {override && canOverride ? (
        <View style={styles.card}>
          <Text style={styles.session}>Owner override</Text>
          <KeyboardSafeTextInput value={overrideReason} onChangeText={setOverrideReason} placeholder="Reason for extra/double booking" style={styles.input} />
          <AppButton label="Cancel override" tone="secondary" onPress={() => setOverride(false)} />
        </View>
      ) : null}
      {bookState.error ? <Text style={styles.error}>{apiError(bookState.error)?.message ?? 'Unable to book follow-up.'}</Text> : null}
      <AppButton label="Book follow-up" loading={bookState.isLoading} disabled={!sessionDefinitionId || !appointmentTime || (override && overrideReason.trim().length < 2)} onPress={() => void submit()} />
      <AppButton label="Cancel" tone="secondary" onPress={() => router.back()} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.surface },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  session: { fontWeight: '800', color: colors.text, fontSize: 17 },
  error: { color: colors.danger },
});

