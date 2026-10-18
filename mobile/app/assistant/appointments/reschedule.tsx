import { pickerDate, formatClinicDate, formatClinicTime, formatClinicTimeRange } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useClinicTimeQuery, useGetAppointmentQuery, useGetAvailabilityQuery, useMeQuery, useRescheduleAppointmentMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { newIdempotencyKey } from '@/features/appointments/idempotency';
import { DatePicker } from '@/components/DatePicker';
import { colors, radius, spacing } from '@/theme/tokens';

export default function RescheduleAppointmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ appointmentId: string }>();
  const appointmentId = String(params.appointmentId ?? '');
  const appointment = useGetAppointmentQuery(appointmentId, { skip: !appointmentId });
  const me = useMeQuery();
  const clinicTime = useClinicTimeQuery();
  const [date, setDate] = useState('');
  const [sessionDefinitionId, setSessionDefinitionId] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [slotModalVisible, setSlotModalVisible] = useState(false);
  const [idempotencyKey] = useState(() => newIdempotencyKey('reschedule'));
  const [reschedule, rescheduleState] = useRescheduleAppointmentMutation();

  useEffect(() => { if (!date && appointment.data?.session.date) setDate(appointment.data.session.date); }, [appointment.data?.session.date, date]);
  const availability = useGetAvailabilityQuery({ doctorId: appointment.data?.doctor.doctor_id ?? '', date }, { skip: !appointment.data?.doctor.doctor_id || !/^\d{4}-\d{2}-\d{2}$/.test(date) });
  const isOwner = Boolean(me.data?.roles.includes('OWNER_ADMIN'));
  const selectedSession = availability.data?.sessions.find(session => session.session_definition_id === sessionDefinitionId);

  if (appointment.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!appointment.data) return <AppScreen><Text>Unable to load appointment.</Text><QueryState query={appointment} label="appointment" /></AppScreen>;

  async function confirm() {
    try {
      const result = await reschedule({ appointmentId, idempotencyKey, body: {
        new_session_definition_id: sessionDefinitionId,
        new_appointment_date: date,
        new_appointment_time: appointmentTime,
        ...(overrideEnabled ? { capacity_override: { enabled: true as const, reason: overrideReason } } : {}),
      } }).unwrap();
      router.replace(`/assistant/appointments/${result.replacement.appointment_id}`);
    } catch { /* rendered below */ }
  }

  return (
    <KeyboardSafeFormScreen>
      <QueryState query={appointment} label="appointment" /><QueryState query={clinicTime} label="clinic date" /><QueryState query={availability} label="availability" /><BackButton />
      <View style={styles.header}><Text style={styles.title}>Reschedule</Text><Text style={styles.subtitle}>{formatClinicDate(appointment.data.session.date)} · {appointment.data.appointment_time ? formatClinicTime(appointment.data.appointment_time) : 'Walk-in'}</Text></View>
      <DatePicker value={date} onChange={value => { setDate(value); setSessionDefinitionId(''); setAppointmentTime(''); }} minimumDate={clinicTime.data?.clinic_date ? pickerDate(clinicTime.data.clinic_date) : undefined} />
      {availability.data?.sessions.map(session => <View key={session.session_definition_id} style={[styles.card, sessionDefinitionId === session.session_definition_id && styles.cardSelected]}>
        <Pressable disabled={session.status === 'BLOCKED'} onPress={() => { setSessionDefinitionId(session.session_definition_id); setAppointmentTime(''); }}><View style={styles.row}><View style={styles.copy}><Text style={styles.cardTitle}>{session.name}</Text><Text style={styles.subtitle}>{formatClinicTimeRange(session.start_time, session.end_time)} · {session.remaining_capacity} free</Text></View></View></Pressable>
        {sessionDefinitionId === session.session_definition_id ? <AppButton compact label={appointmentTime ? formatClinicTime(appointmentTime) : 'Select time'} onPress={() => setSlotModalVisible(true)} tone={appointmentTime ? 'primary' : 'secondary'} /> : null}
      </View>)}
      <Modal visible={slotModalVisible} transparent animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>Select time</Text><View style={styles.slots}>{selectedSession?.slots.map(slot => {
        const selectable = slot.normal_booking_allowed || (isOwner && overrideEnabled && selectedSession.status !== 'BLOCKED');
        return <Pressable key={slot.time} disabled={!selectable} onPress={() => { setAppointmentTime(slot.time); setSlotModalVisible(false); }} style={[styles.slot, !selectable && styles.disabled, appointmentTime === slot.time && styles.selected]}><Text style={appointmentTime === slot.time ? styles.selectedText : styles.slotText}>{formatClinicTime(slot.time)}</Text></Pressable>;
      })}</View><AppButton label="Close" tone="secondary" onPress={() => setSlotModalVisible(false)} /></View></View></Modal>
      {isOwner ? <View style={styles.card}><Pressable onPress={() => setOverrideEnabled(value => !value)}><Text style={styles.cardTitle}>{overrideEnabled ? '✓ ' : ''}Capacity override</Text></Pressable>{overrideEnabled ? <KeyboardSafeTextInput value={overrideReason} onChangeText={setOverrideReason} style={styles.input} placeholder="Required reason" /> : null}</View> : null}
      {rescheduleState.error ? <Text style={styles.error}>{apiError(rescheduleState.error)?.message ?? 'Unable to reschedule appointment.'}</Text> : null}
      <AppButton label="Confirm Reschedule" loading={rescheduleState.isLoading} disabled={!sessionDefinitionId || !appointmentTime || (overrideEnabled && overrideReason.trim().length < 2)} onPress={() => void confirm()} /><AppButton compact label="Cancel" tone="secondary" onPress={() => router.back()} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 3 }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, copy: { flex: 1, gap: 3 }, title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark }, subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 }, input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 14 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }, cardSelected: { borderColor: colors.primary }, cardTitle: { color: colors.primaryDark, fontWeight: '800' }, slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, slot: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surfaceSoft, paddingHorizontal: 12, paddingVertical: 10 }, disabled: { opacity: 0.35 }, selected: { backgroundColor: colors.primary, borderColor: colors.primary }, slotText: { color: colors.text, fontSize: 12 }, selectedText: { color: colors.surface, fontWeight: '800', fontSize: 12 }, error: { color: colors.danger },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(10,45,98,0.28)', justifyContent: 'flex-end' }, modalContent: { backgroundColor: colors.background, padding: spacing.lg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '80%', gap: spacing.md }, modalTitle: { fontSize: 22, fontWeight: '800', color: colors.primaryDark },
});
