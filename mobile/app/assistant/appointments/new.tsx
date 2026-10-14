import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  useClinicTimeQuery,
  useGetAvailabilityQuery,
  useGetCurrentFeeQuery,
  useGetPatientQuery,
  useListDoctorsQuery,
  useMeQuery,
} from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { DatePicker } from '@/components/DatePicker';
import { colors, radius, spacing } from '@/theme/tokens';

export default function NewAppointmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    patientId?: string;
    appointmentType?: string;
    followupId?: string;
    dueDate?: string;
    doctorId?: string;
    date?: string;
  }>();
  const patientId = String(params.patientId ?? '');
  const followupId = params.followupId;
  const patient = useGetPatientQuery(patientId, { skip: !patientId });
  const doctors = useListDoctorsQuery();
  const me = useMeQuery();
  const clinicTime = useClinicTimeQuery();
  const fee = useGetCurrentFeeQuery();

  const [date, setDate] = useState(params.date || '');
  const [doctorId, setDoctorId] = useState(params.doctorId || '');
  const [appointmentType, setAppointmentType] = useState<'REGULAR' | 'FOLLOW_UP'>(
    params.appointmentType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'REGULAR',
  );
  const [sessionDefinitionId, setSessionDefinitionId] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [slotModalVisible, setSlotModalVisible] = useState(false);

  useEffect(() => {
    if (!clinicTime.data?.clinic_date) return;
    if (!date) {
      if (params.dueDate) {
        setDate(params.dueDate >= clinicTime.data.clinic_date ? params.dueDate : clinicTime.data.clinic_date);
      } else if (params.date) {
        setDate(params.date);
      } else {
        setDate(clinicTime.data.clinic_date);
      }
    }
  }, [clinicTime.data?.clinic_date, date, params.date, params.dueDate]);

  useEffect(() => {
    if (params.doctorId) {
      setDoctorId(params.doctorId);
    } else if (!doctorId && doctors.data?.[0]?.doctor_id) {
      setDoctorId(doctors.data[0].doctor_id);
    }
  }, [params.doctorId, doctors.data, doctorId]);

  useEffect(() => {
    setSessionDefinitionId('');
    setAppointmentTime('');
    setOverrideEnabled(false);
    setOverrideReason('');
  }, [patientId]);

  const availability = useGetAvailabilityQuery(
    { doctorId, date },
    { skip: !doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(date) },
  );
  const isOwner = Boolean(me.data?.roles.includes('OWNER_ADMIN'));
  const selectedSession = availability.data?.sessions.find(
    (session) => session.session_definition_id === sessionDefinitionId,
  );
  const feeAmount = useMemo(() => {
    if (!fee.data) return null;
    return appointmentType === 'REGULAR' ? fee.data.regular_fee : fee.data.followup_fee;
  }, [appointmentType, fee.data]);

  useEffect(() => {
    setSessionDefinitionId('');
    setAppointmentTime('');
    setOverrideEnabled(false);
    setOverrideReason('');
  }, [date, doctorId]);

  if (!patientId) {
    return (
      <AppScreen>
        <BackButton />
        <Text style={styles.title}>New Appointment</Text>
        <Text style={styles.subtitle}>Select a patient before booking.</Text>
        <AppButton label="Search Patient" onPress={() => router.push('/assistant/patients')} />
      </AppScreen>
    );
  }

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <Text style={styles.title}>New Appointment</Text>
      <Text style={styles.subtitle}>
        {patient.data ? `${patient.data.full_name} · ${patient.data.patient_code}` : 'Loading patient…'}
      </Text>

      <Text style={styles.label}>Appointment Type</Text>
      <View style={styles.chips}>
        {(['REGULAR', 'FOLLOW_UP'] as const).map((type) => (
          <Pressable key={type} onPress={() => setAppointmentType(type)} style={[styles.chip, appointmentType === type && styles.chipActive]}>
            <Text style={appointmentType === type ? styles.chipTextActive : styles.chipText}>
              {type === 'REGULAR' ? 'Regular Consultation' : 'Follow-up'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Doctor</Text>
      <View style={styles.chips}>
        {doctors.data?.map((doctor) => (
          <Pressable 
            key={doctor.doctor_id} 
            onPress={() => {
              setDoctorId(doctor.doctor_id);
              setSessionDefinitionId('');
              setAppointmentTime('');
            }} 
            style={[styles.chip, doctorId === doctor.doctor_id && styles.chipActive]}>
            <Text style={doctorId === doctor.doctor_id ? styles.chipTextActive : styles.chipText}>{doctor.display_name}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Date</Text>
      <DatePicker
        value={date}
        onChange={(val) => {
          setDate(val);
          setSessionDefinitionId('');
          setAppointmentTime('');
        }}
        minimumDate={clinicTime.data?.clinic_date ? new Date(clinicTime.data.clinic_date) : undefined}
      />

      <Text style={styles.label}>Session</Text>
      {availability.isFetching ? <ActivityIndicator /> : null}
      {!availability.isFetching && availability.data?.sessions.length === 0 ? (
        <Text style={styles.subtitle}>No appointment sessions are available on this date.{"\n"}Select another date.</Text>
      ) : null}
      {availability.data?.sessions.map((session) => {
        const selected = sessionDefinitionId === session.session_definition_id;
        const isFull = session.remaining_capacity <= 0;
        const disabled = session.status === 'BLOCKED' || (isFull && !isOwner);
        return (
          <View key={session.session_definition_id} style={[styles.card, selected && styles.cardSelected, disabled && !selected && { opacity: 0.5 }]}>
            <Pressable
              disabled={disabled}
              onPress={() => {
                setSessionDefinitionId(session.session_definition_id);
                setAppointmentTime('');
              }}
            >
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{session.name}</Text>
                  <Text style={styles.subtitle}>{shortTime(session.start_time)}–{shortTime(session.end_time)} · {session.used_capacity} / {session.maximum_capacity} booked</Text>
                </View>
                <Text style={session.status === 'BLOCKED' ? styles.danger : (isFull ? styles.danger : styles.success)}>
                  {session.status === 'BLOCKED' ? 'BLOCKED' : (isFull ? 'FULL' : 'AVAILABLE')}
                </Text>
              </View>
            </Pressable>
            {selected ? (
              <View>
                <AppButton 
                  label={appointmentTime ? `Selected Time: ${shortTime(appointmentTime)}` : "Select Time"} 
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
                              style={[
                                styles.slot,
                                !selectable && styles.slotDisabled,
                                appointmentTime === slot.time && styles.slotSelected,
                              ]}
                            >
                              <Text style={appointmentTime === slot.time ? styles.slotSelectedText : styles.slotText}>{shortTime(slot.time)}</Text>
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
        );
      })}

      {isOwner && selectedSession?.status !== 'BLOCKED' ? (
        <View style={styles.card}>
          <Pressable onPress={() => setOverrideEnabled((value) => !value)}>
            <Text style={styles.cardTitle}>{overrideEnabled ? '✓ ' : ''}Owner capacity/slot override</Text>
            <Text style={styles.subtitle}>Use only when intentionally adding an extra or double-booked patient.</Text>
          </Pressable>
          {overrideEnabled ? (
            <KeyboardSafeTextInput
              value={overrideReason}
              onChangeText={setOverrideReason}
              placeholder="Required override reason"
              style={styles.input}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.feeCard}>
        <Text style={styles.label}>Suggested Fee</Text>
        <Text style={styles.fee}>₹{feeAmount ?? '—'}</Text>
      </View>

      <AppButton
        label="Review Booking"
        disabled={!patient.data || !doctorId || !sessionDefinitionId || !appointmentTime || (overrideEnabled && overrideReason.trim().length < 2)}
        onPress={() =>
          router.push({
            pathname: '/assistant/appointments/review',
            params: {
              patientId,
              doctorId,
              sessionDefinitionId,
              appointmentDate: date,
              appointmentTime,
              appointmentType,
              overrideEnabled: overrideEnabled ? '1' : '0',
              overrideReason,
              followupId: followupId ?? '',
            },
          })
        }
      />
      {!sessionDefinitionId || !appointmentTime ? (
        <Text style={[styles.subtitle, { textAlign: 'center', marginTop: spacing.sm }]}>
          Select a session and appointment time to continue.
        </Text>
      ) : null}
    </KeyboardSafeFormScreen>
  );
}

function shortTime(value: string) {
  return value.slice(0, 5);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '700', paddingTop: 6 },
  label: { fontWeight: '800', color: colors.text },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 14, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipActive: { backgroundColor: colors.softPrimary, borderColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardSelected: { borderColor: colors.primary },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  success: { color: colors.success, fontWeight: '800' },
  danger: { color: colors.danger, fontWeight: '800' },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  slot: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9 },
  slotDisabled: { opacity: 0.35 },
  slotSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  slotText: { color: colors.text, fontWeight: '600' },
  slotSelectedText: { color: '#FFFFFF', fontWeight: '800' },
  feeCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.softPrimary, padding: spacing.md, borderRadius: radius.md },
  fee: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.background, padding: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '80%' },
});


