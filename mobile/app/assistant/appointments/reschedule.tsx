import { pickerDate, formatClinicDate, formatClinicTime, formatClinicTimeRange } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useClinicTimeQuery, useGetAppointmentQuery, useGetAvailabilityQuery, useMeQuery, useRescheduleAppointmentMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { useIntentIdempotencyKey } from '@/features/appointments/idempotency';
import { TimeSlotPickerModal } from '@/features/appointments/TimeSlotPickerModal';
import { DatePicker } from '@/components/DatePicker';
import { colors, radius, spacing } from '@/theme/tokens';

export default function RescheduleAppointmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ appointmentId: string; returnToFollowupId?: string; returnToAppointments?: string }>();
  const appointmentId = String(params.appointmentId ?? '');
  const returnToFollowupId = String(params.returnToFollowupId ?? '');
  const appointment = useGetAppointmentQuery(appointmentId, { skip: !appointmentId });
  const me = useMeQuery();
  const clinicTime = useClinicTimeQuery();
  const [date, setDate] = useState('');
  const [sessionDefinitionId, setSessionDefinitionId] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [slotModalVisible, setSlotModalVisible] = useState(false);
  const [reschedule, rescheduleState] = useRescheduleAppointmentMutation();

  useEffect(() => {
    if (!date && appointment.data?.session.date) setDate(appointment.data.session.date);
  }, [appointment.data?.session.date, date]);

  const availability = useGetAvailabilityQuery(
    { doctorId: appointment.data?.doctor.doctor_id ?? '', date },
    { skip: !appointment.data?.doctor.doctor_id || !/^\d{4}-\d{2}-\d{2}$/.test(date) },
  );
  const isOwner = Boolean(me.data?.roles.includes('OWNER_ADMIN'));
  const selectedSession = availability.data?.sessions.find(session => session.session_definition_id === sessionDefinitionId);
  const rescheduleIntent = JSON.stringify({
    appointment_id: appointmentId,
    new_session_definition_id: sessionDefinitionId,
    new_appointment_date: date,
    new_appointment_time: appointmentTime,
    capacity_override: overrideEnabled ? { enabled: true, reason: overrideReason } : null,
  });
  const rescheduleRequest = useIntentIdempotencyKey('reschedule', rescheduleIntent);

  if (appointment.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!appointment.data) return <AppScreen><Text>Unable to load appointment.</Text><QueryState query={appointment} label="appointment" /></AppScreen>;

  const item = appointment.data;
  const isFollowUp = item.appointment_type === 'FOLLOW_UP';
  const slotOptions = selectedSession?.slots.map(slot => ({
    time: slot.time,
    disabled: !(slot.normal_booking_allowed || (isOwner && overrideEnabled && selectedSession.status !== 'BLOCKED')),
  })) ?? [];

  async function confirm() {
    try {
      const result = await reschedule({
        appointmentId,
        idempotencyKey: rescheduleRequest.getKey(),
        body: {
          new_session_definition_id: sessionDefinitionId,
          new_appointment_date: date,
          new_appointment_time: appointmentTime,
          ...(overrideEnabled ? { capacity_override: { enabled: true as const, reason: overrideReason } } : {}),
        },
      }).unwrap();
      router.replace({
        pathname: '/assistant/appointments/[appointmentId]',
        params: {
          appointmentId: result.replacement.appointment_id,
          ...(returnToFollowupId ? { returnToFollowupId } : { returnToAppointments: '1' }),
        },
      });
    } catch {
      // The current request error is rendered below.
    }
  }

  const currentError = rescheduleRequest.resultMatchesIntent ? apiError(rescheduleState.error) : null;

  return (
    <KeyboardSafeFormScreen>
      <QueryState query={appointment} label="appointment" />
      <QueryState query={clinicTime} label="clinic date" />
      <QueryState query={availability} label="availability" />
      <BackButton />
      <View style={styles.header}>
        <Text style={styles.title}>{isFollowUp ? 'Reschedule follow-up' : 'Reschedule appointment'}</Text>
        <Text style={styles.patientContext}>{item.patient.full_name} · {item.patient.patient_code}</Text>
        <Text style={styles.subtitle}>Current: {formatClinicDate(item.session.date)} · {item.appointment_time ? formatClinicTime(item.appointment_time) : 'Walk-in'}</Text>
      </View>
      <DatePicker
        value={date}
        onChange={value => {
          if (value === date) return;
          setDate(value);
          setSessionDefinitionId('');
          setAppointmentTime('');
        }}
        minimumDate={clinicTime.data?.clinic_date ? pickerDate(clinicTime.data.clinic_date) : undefined}
      />
      {availability.data?.sessions.map(session => (
        <View key={session.session_definition_id} style={[styles.card, sessionDefinitionId === session.session_definition_id && styles.cardSelected]}>
          <Pressable
            disabled={session.status === 'BLOCKED'}
            onPress={() => {
              if (sessionDefinitionId === session.session_definition_id) return;
              setSessionDefinitionId(session.session_definition_id);
              setAppointmentTime('');
            }}
          >
            <View style={styles.row}>
              <View style={styles.copy}>
                <Text style={styles.cardTitle}>{session.name}</Text>
                <Text style={styles.subtitle}>{formatClinicTimeRange(session.start_time, session.end_time)} · {session.remaining_capacity} free</Text>
              </View>
            </View>
          </Pressable>
          {sessionDefinitionId === session.session_definition_id ? <AppButton compact label={appointmentTime ? formatClinicTime(appointmentTime) : 'Select time'} onPress={() => setSlotModalVisible(true)} tone={appointmentTime ? 'primary' : 'secondary'} /> : null}
        </View>
      ))}
      <TimeSlotPickerModal
        visible={slotModalVisible}
        slots={slotOptions}
        selectedTime={appointmentTime}
        onSelect={(time) => {
          setAppointmentTime(time);
          setSlotModalVisible(false);
        }}
        onClose={() => setSlotModalVisible(false)}
      />
      {isOwner ? (
        <View style={styles.card}>
          <Pressable onPress={() => setOverrideEnabled(value => !value)}><Text style={styles.cardTitle}>{overrideEnabled ? '✓ ' : ''}Capacity override</Text></Pressable>
          {overrideEnabled ? <KeyboardSafeTextInput value={overrideReason} onChangeText={setOverrideReason} style={styles.input} placeholder="Required reason" /> : null}
        </View>
      ) : null}
      {currentError ? <Text style={styles.error}>{currentError.message ?? 'Unable to reschedule appointment.'}</Text> : null}
      <AppButton label="Confirm reschedule" loading={rescheduleState.isLoading} disabled={!sessionDefinitionId || !appointmentTime || (overrideEnabled && overrideReason.trim().length < 2)} onPress={() => void confirm()} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 3 }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, copy: { flex: 1, gap: 3 }, title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark }, patientContext: { color: colors.text, fontSize: 14, fontWeight: '700' }, subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 }, input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 14 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }, cardSelected: { borderColor: colors.primary }, cardTitle: { color: colors.primaryDark, fontWeight: '800' }, error: { color: colors.danger },
});
