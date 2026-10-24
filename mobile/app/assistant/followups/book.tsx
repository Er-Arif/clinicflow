import { formatClinicDate, formatClinicTime, formatClinicTimeRange } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useBookFollowUpMutation, useClinicTimeQuery, useGetAvailabilityQuery, useGetCurrentFeeQuery, useGetFollowUpQuery, useListDoctorsQuery, useMeQuery } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { useIntentIdempotencyKey } from '@/features/appointments/idempotency';
import { TimeSlotPickerModal } from '@/features/appointments/TimeSlotPickerModal';
import { colors, radius, spacing } from '@/theme/tokens';

export default function BookFollowUpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ followupId: string }>();
  const followupId = String(params.followupId ?? '');
  const followup = useGetFollowUpQuery(followupId, { skip: !followupId });
  const clinicTime = useClinicTimeQuery();
  const doctors = useListDoctorsQuery();
  const fee = useGetCurrentFeeQuery();
  const me = useMeQuery();
  const [sessionDefinitionId, setSessionDefinitionId] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [slotModalVisible, setSlotModalVisible] = useState(false);
  const [bookFollowUp, bookState] = useBookFollowUpMutation();

  const clinicDate = clinicTime.data?.clinic_date ?? '';
  const dueDate = followup.data?.due_date ?? '';
  const appointmentDate = dueDate && clinicDate ? (dueDate >= clinicDate ? dueDate : clinicDate) : '';
  const overdue = Boolean(dueDate && clinicDate && dueDate < clinicDate);
  const availability = useGetAvailabilityQuery(
    { doctorId: followup.data?.doctor_id ?? '', date: appointmentDate },
    { skip: !followup.data?.doctor_id || !appointmentDate },
  );
  const selectedSession = useMemo(
    () => availability.data?.sessions.find((session) => session.session_definition_id === sessionDefinitionId),
    [availability.data?.sessions, sessionDefinitionId],
  );
  const canOverride = me.data?.permissions.includes('appointment.capacity_override') ?? false;
  const doctorName = doctors.data?.find((doctor) => doctor.doctor_id === followup.data?.doctor_id)?.display_name ?? 'Assigned doctor';
  const bookingIntent = JSON.stringify({
    followup_id: followupId,
    session_definition_id: sessionDefinitionId,
    appointment_date: appointmentDate,
    appointment_time: appointmentTime,
    capacity_override: override ? { enabled: true, reason: overrideReason } : null,
  });
  const bookingRequest = useIntentIdempotencyKey('followup-book', bookingIntent);

  async function submit() {
    if (!sessionDefinitionId || !appointmentTime || !appointmentDate) return;
    try {
      await bookFollowUp({
        followupId,
        idempotencyKey: bookingRequest.getKey(),
        body: {
          session_definition_id: sessionDefinitionId,
          appointment_date: appointmentDate,
          appointment_time: appointmentTime,
          ...(override ? { capacity_override: { enabled: true as const, reason: overrideReason } } : {}),
        },
      }).unwrap();
      router.dismissTo({ pathname: '/assistant/followups/[followupId]', params: { followupId } });
    } catch {
      // The current request error is rendered below.
    }
  }

  if (followup.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!followup.data) return <AppScreen><BackButton /><Text style={styles.title}>Unable to load follow-up</Text><QueryState query={followup} label="follow-up" /></AppScreen>;
  const currentError = bookingRequest.resultMatchesIntent ? apiError(bookState.error) : null;
  const timeSlots = (selectedSession?.slots ?? []).map((slot) => ({
    time: slot.time,
    disabled: !(slot.normal_booking_allowed || (canOverride && selectedSession?.status !== 'BLOCKED')),
  }));

  return (
    <KeyboardSafeFormScreen>
      <QueryState query={followup} label="follow-up" />
      <QueryState query={clinicTime} label="clinic date" />
      <QueryState query={availability} label="availability" />
      <BackButton />
      <View style={styles.header}>
        <Text style={styles.title}>Book follow-up</Text>
        <Text style={styles.subtitle}>{followup.data.patient.full_name} · {followup.data.patient.patient_code}</Text>
      </View>

      <View style={styles.summaryCard}>
        <Row label="Date" value={appointmentDate ? formatClinicDate(appointmentDate) : '—'} />
        <Row label="Doctor" value={doctorName} />
        <Row label="Fee" value={`₹${fee.data?.followup_fee ?? '—'}`} />
      </View>
      {overdue ? <Text style={styles.notice}>This follow-up was due {formatClinicDate(dueDate)}. Because that date has passed, booking uses today’s clinic date.</Text> : <Text style={styles.hint}>Date is fixed from the follow-up recommendation.</Text>}

      <Text style={styles.label}>Session</Text>
      {!availability.isFetching && !availability.isError && availability.data?.sessions.length === 0 ? <Text style={styles.empty}>No sessions are available on this follow-up date.</Text> : null}
      {availability.data?.sessions.map((session) => {
        const selected = sessionDefinitionId === session.session_definition_id;
        const isFull = session.remaining_capacity <= 0;
        const disabled = session.status === 'BLOCKED' || (isFull && !canOverride);
        return (
          <View key={session.session_definition_id} style={[styles.card, selected && styles.cardSelected, disabled && !selected && styles.disabledCard]}>
            <Pressable disabled={disabled} onPress={() => { if (selected) return; setSessionDefinitionId(session.session_definition_id); setAppointmentTime(''); setOverride(false); setOverrideReason(''); }}>
              <View style={styles.row}>
                <View style={styles.copy}>
                  <Text style={styles.cardTitle}>{session.name}</Text>
                  <Text style={styles.subtitle}>{formatClinicTimeRange(session.start_time, session.end_time)} · {session.used_capacity}/{session.maximum_capacity} booked</Text>
                </View>
                <Text style={session.status === 'BLOCKED' || isFull ? styles.danger : styles.success}>{session.status === 'BLOCKED' ? 'Blocked' : isFull ? 'Full' : 'Available'}</Text>
              </View>
            </Pressable>
            {selected ? <AppButton compact label={appointmentTime ? formatClinicTime(appointmentTime) : 'Select time'} onPress={() => setSlotModalVisible(true)} tone={appointmentTime ? 'selection' : 'secondary'} /> : null}
          </View>
        );
      })}

      <TimeSlotPickerModal
        visible={slotModalVisible}
        slots={timeSlots}
        selectedTime={appointmentTime}
        onSelect={(time) => {
          setAppointmentTime(time);
          const slot = selectedSession?.slots.find((item) => item.time === time);
          setOverride(Boolean(slot && !slot.normal_booking_allowed));
          if (slot?.normal_booking_allowed) setOverrideReason('');
          setSlotModalVisible(false);
        }}
        onClose={() => setSlotModalVisible(false)}
      />

      {override && canOverride ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Capacity override</Text>
          <Text style={styles.subtitle}>This slot needs an authorized override.</Text>
          <KeyboardSafeTextInput value={overrideReason} onChangeText={setOverrideReason} placeholder="Required reason" style={styles.input} />
          <AppButton label="Choose another time" tone="secondary" onPress={() => { setAppointmentTime(''); setOverride(false); setOverrideReason(''); setSlotModalVisible(true); }} />
        </View>
      ) : null}

      {currentError ? <Text style={styles.error}>{currentError.message ?? 'Unable to book follow-up.'}</Text> : null}
      <AppButton label="Book follow-up" loading={bookState.isLoading} disabled={!sessionDefinitionId || !appointmentTime || !appointmentDate || (override && overrideReason.trim().length < 2)} onPress={() => void submit()} />
      <AppButton label="Cancel" tone="secondary" onPress={() => router.back()} />
    </KeyboardSafeFormScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  header: { gap: 3 },
  title: { fontSize: 28, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, lineHeight: 19, fontSize: 13 },
  label: { fontWeight: '700', color: colors.text },
  empty: { color: colors.muted, fontSize: 13 },
  hint: { color: colors.muted, fontSize: 12 },
  notice: { color: colors.warning ?? colors.muted, fontSize: 12, lineHeight: 18 },
  summaryCard: { backgroundColor: colors.softPrimary, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  summaryLabel: { color: colors.muted, fontWeight: '600' },
  summaryValue: { color: colors.primaryDark, fontWeight: '800', flex: 1, textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1, gap: 3 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  cardSelected: { borderColor: colors.accent, backgroundColor: '#FBFDFF' },
  disabledCard: { opacity: 0.5 },
  cardTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 16 },
  success: { color: colors.success, fontWeight: '700', fontSize: 12 },
  danger: { color: colors.danger, fontWeight: '700', fontSize: 12 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.surface, color: colors.text },
  error: { color: colors.danger },
});