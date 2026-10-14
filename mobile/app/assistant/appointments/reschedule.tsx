import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useClinicTimeQuery, useGetAppointmentQuery, useGetAvailabilityQuery, useMeQuery, useRescheduleAppointmentMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
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

  useEffect(() => {
    if (!date && appointment.data?.session.date) setDate(appointment.data.session.date);
  }, [appointment.data?.session.date, date]);
  const availability = useGetAvailabilityQuery(
    { doctorId: appointment.data?.doctor.doctor_id ?? '', date },
    { skip: !appointment.data?.doctor.doctor_id || !/^\d{4}-\d{2}-\d{2}$/.test(date) },
  );
  const isOwner = Boolean(me.data?.roles.includes('OWNER_ADMIN'));

  if (appointment.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!appointment.data) return <AppScreen><Text>Appointment not found.</Text></AppScreen>;

  async function confirm() {
    try {
      const result = await reschedule({
        appointmentId,
        idempotencyKey,
        body: {
          new_session_definition_id: sessionDefinitionId,
          new_appointment_date: date,
          new_appointment_time: appointmentTime,
          ...(overrideEnabled ? { capacity_override: { enabled: true as const, reason: overrideReason } } : {}),
        },
      }).unwrap();
      router.replace(`/assistant/appointments/${result.replacement.appointment_id}`);
    } catch {
      // error rendered below
    }
  }

  return (
    <KeyboardSafeFormScreen>
      <Text style={styles.title}>Reschedule Appointment</Text>
      <Text style={styles.subtitle}>Original: {appointment.data.session.date} · {appointment.data.appointment_time?.slice(0, 5)}</Text>
        <DatePicker
          value={date}
          onChange={(value) => { setDate(value); setSessionDefinitionId(''); setAppointmentTime(''); }}
          minimumDate={clinicTime.data?.clinic_date ? new Date(clinicTime.data.clinic_date) : undefined}
        />
      {availability.data?.sessions.map((session) => (
        <View key={session.session_definition_id} style={styles.card}>
          <Pressable disabled={session.status === 'BLOCKED'} onPress={() => { setSessionDefinitionId(session.session_definition_id); setAppointmentTime(''); }}>
            <Text style={styles.cardTitle}>{session.name} · {session.remaining_capacity} free</Text>
          </Pressable>
          {sessionDefinitionId === session.session_definition_id ? (
            <View>
              <AppButton 
                label={appointmentTime ? `Selected Time: ${appointmentTime.slice(0, 5)}` : "Select Time"} 
                onPress={() => setSlotModalVisible(true)} 
                tone={appointmentTime ? "primary" : "secondary"}
              />
              <Modal visible={slotModalVisible} transparent={true} animationType="slide">
                <View style={styles.modalOverlay}>
                  <View style={styles.modalContent}>
                    <Text style={[styles.title, { marginBottom: spacing.md }]}>Select Time</Text>
                    <View style={styles.slots}>
                      {session.slots.map((slot) => {
                        const selectable = slot.normal_booking_allowed || (isOwner && overrideEnabled && session.status !== 'BLOCKED');
                        return (
                          <Pressable 
                            key={slot.time} 
                            disabled={!selectable} 
                            onPress={() => {
                              setAppointmentTime(slot.time);
                              setSlotModalVisible(false);
                            }} 
                            style={[styles.slot, !selectable && styles.disabled, appointmentTime === slot.time && styles.selected]}
                          >
                            <Text style={appointmentTime === slot.time ? styles.selectedText : styles.slotText}>{slot.time.slice(0, 5)}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={{ marginTop: spacing.lg }}>
                      <AppButton label="Close" tone="secondary" onPress={() => setSlotModalVisible(false)} />
                    </View>
                  </View>
                </View>
              </Modal>
            </View>
          ) : null}
        </View>
      ))}
      {isOwner ? (
        <View style={styles.card}>
          <Pressable onPress={() => setOverrideEnabled((value) => !value)}><Text style={styles.cardTitle}>{overrideEnabled ? '✓ ' : ''}Owner override</Text></Pressable>
          {overrideEnabled ? <KeyboardSafeTextInput value={overrideReason} onChangeText={setOverrideReason} style={styles.input} placeholder="Required override reason" /> : null}
        </View>
      ) : null}
      {rescheduleState.error ? <Text style={styles.error}>{apiError(rescheduleState.error)?.message ?? 'Unable to reschedule appointment.'}</Text> : null}
      <AppButton label="Confirm Reschedule" loading={rescheduleState.isLoading} disabled={!sessionDefinitionId || !appointmentTime || (overrideEnabled && overrideReason.trim().length < 2)} onPress={() => void confirm()} />
      <AppButton label="Cancel" tone="secondary" onPress={() => router.back()} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 14 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardTitle: { color: colors.text, fontWeight: '800' },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  slot: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9 },
  disabled: { opacity: 0.35 },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  slotText: { color: colors.text },
  selectedText: { color: '#FFFFFF', fontWeight: '800' },
  error: { color: colors.danger },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.background, padding: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '80%' },
});

