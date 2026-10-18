import { pickerDate, formatClinicTime, formatClinicTimeRange } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useClinicTimeQuery, useGetAvailabilityQuery, useGetCurrentFeeQuery, useGetPatientQuery, useListDoctorsQuery, useMeQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { DatePicker } from '@/components/DatePicker';
import { colors, radius, spacing } from '@/theme/tokens';

export default function NewAppointmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ patientId?: string; appointmentType?: string; followupId?: string; dueDate?: string; doctorId?: string; date?: string }>();
  const patientId = String(params.patientId ?? '');
  const followupId = params.followupId;
  const patient = useGetPatientQuery(patientId, { skip: !patientId });
  const doctors = useListDoctorsQuery();
  const me = useMeQuery();
  const clinicTime = useClinicTimeQuery();
  const fee = useGetCurrentFeeQuery();
  const [date, setDate] = useState(params.date || '');
  const [doctorId, setDoctorId] = useState(params.doctorId || '');
  const [appointmentType, setAppointmentType] = useState<'REGULAR' | 'FOLLOW_UP'>(params.appointmentType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'REGULAR');
  const [sessionDefinitionId, setSessionDefinitionId] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [slotModalVisible, setSlotModalVisible] = useState(false);

  useEffect(() => {
    if (!clinicTime.data?.clinic_date || date) return;
    if (params.dueDate) setDate(params.dueDate >= clinicTime.data.clinic_date ? params.dueDate : clinicTime.data.clinic_date);
    else if (params.date) setDate(params.date);
    else setDate(clinicTime.data.clinic_date);
  }, [clinicTime.data?.clinic_date, date, params.date, params.dueDate]);
  useEffect(() => { if (params.doctorId) setDoctorId(params.doctorId); else if (!doctorId && doctors.data?.[0]?.doctor_id) setDoctorId(doctors.data[0].doctor_id); }, [params.doctorId, doctors.data, doctorId]);
  useEffect(() => { setSessionDefinitionId(''); setAppointmentTime(''); setOverrideEnabled(false); setOverrideReason(''); }, [patientId]);

  const availability = useGetAvailabilityQuery({ doctorId, date }, { skip: !doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(date) });
  const isOwner = Boolean(me.data?.roles.includes('OWNER_ADMIN'));
  const selectedSession = availability.data?.sessions.find(session => session.session_definition_id === sessionDefinitionId);
  const feeAmount = useMemo(() => !fee.data ? null : appointmentType === 'REGULAR' ? fee.data.regular_fee : fee.data.followup_fee, [appointmentType, fee.data]);
  useEffect(() => { setSessionDefinitionId(''); setAppointmentTime(''); setOverrideEnabled(false); setOverrideReason(''); }, [date, doctorId]);

  if (!patientId) return <AppScreen><BackButton /><Text style={styles.title}>New Appointment</Text><Text style={styles.subtitle}>Choose a patient first.</Text><AppButton label="Search Patient" onPress={() => router.push('/assistant/patients')} /></AppScreen>;

  return (
    <KeyboardSafeFormScreen>
      <QueryState query={clinicTime} label="clinic date" /><QueryState query={availability} label="availability" /><BackButton />
      <View style={styles.header}><Text style={styles.title}>New Appointment</Text><Text style={styles.subtitle}>{patient.data ? `${patient.data.full_name} · ${patient.data.patient_code}` : 'Loading patient…'}</Text></View>
      <Text style={styles.label}>Type</Text>
      <View style={styles.chips}>{(['REGULAR', 'FOLLOW_UP'] as const).map(type => <Pressable key={type} onPress={() => setAppointmentType(type)} style={[styles.chip, appointmentType === type && styles.chipActive]}><Text style={appointmentType === type ? styles.chipTextActive : styles.chipText}>{type === 'REGULAR' ? 'Regular' : 'Follow-up'}</Text></Pressable>)}</View>
      <Text style={styles.label}>Doctor</Text>
      <View style={styles.chips}>{doctors.data?.map(doctor => <Pressable key={doctor.doctor_id} onPress={() => { setDoctorId(doctor.doctor_id); setSessionDefinitionId(''); setAppointmentTime(''); }} style={[styles.chip, doctorId === doctor.doctor_id && styles.chipActive]}><Text style={doctorId === doctor.doctor_id ? styles.chipTextActive : styles.chipText}>{doctor.display_name}</Text></Pressable>)}</View>
      <Text style={styles.label}>Date</Text>
      <DatePicker value={date} onChange={value => { setDate(value); setSessionDefinitionId(''); setAppointmentTime(''); }} minimumDate={clinicTime.data?.clinic_date ? pickerDate(clinicTime.data.clinic_date) : undefined} />
      <Text style={styles.label}>Session</Text>
      {!availability.isFetching && !availability.isError && availability.data?.sessions.length === 0 ? <Text style={styles.empty}>No sessions available. Choose another date.</Text> : null}
      {availability.data?.sessions.map(session => {
        const selected = sessionDefinitionId === session.session_definition_id;
        const isFull = session.remaining_capacity <= 0;
        const disabled = session.status === 'BLOCKED' || (isFull && !isOwner);
        return <View key={session.session_definition_id} style={[styles.card, selected && styles.cardSelected, disabled && !selected && styles.disabledCard]}>
          <Pressable disabled={disabled} onPress={() => { setSessionDefinitionId(session.session_definition_id); setAppointmentTime(''); }}><View style={styles.row}><View style={styles.copy}><Text style={styles.cardTitle}>{session.name}</Text><Text style={styles.subtitle}>{formatClinicTimeRange(session.start_time, session.end_time)} · {session.used_capacity}/{session.maximum_capacity} booked</Text></View><Text style={session.status === 'BLOCKED' || isFull ? styles.danger : styles.success}>{session.status === 'BLOCKED' ? 'Blocked' : isFull ? 'Full' : 'Available'}</Text></View></Pressable>
          {selected ? <AppButton compact label={appointmentTime ? formatClinicTime(appointmentTime) : 'Select time'} onPress={() => setSlotModalVisible(true)} tone={appointmentTime ? 'primary' : 'secondary'} /> : null}
        </View>;
      })}
      <Modal visible={slotModalVisible} transparent animationType="slide"><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>Select time</Text><View style={styles.slots}>{selectedSession?.slots.map(slot => {
        const selectable = slot.normal_booking_allowed || (isOwner && overrideEnabled && selectedSession.status !== 'BLOCKED');
        return <Pressable key={slot.time} disabled={!selectable} onPress={() => { setAppointmentTime(slot.time); setSlotModalVisible(false); }} style={[styles.slot, !selectable && styles.slotDisabled, appointmentTime === slot.time && styles.slotSelected]}><Text style={appointmentTime === slot.time ? styles.slotSelectedText : styles.slotText}>{formatClinicTime(slot.time)}</Text></Pressable>;
      })}</View><AppButton label="Close" tone="secondary" onPress={() => setSlotModalVisible(false)} /></View></View></Modal>
      {isOwner && selectedSession?.status !== 'BLOCKED' ? <View style={styles.card}><Pressable onPress={() => setOverrideEnabled(value => !value)}><Text style={styles.cardTitle}>{overrideEnabled ? '✓ ' : ''}Capacity override</Text></Pressable>{overrideEnabled ? <KeyboardSafeTextInput value={overrideReason} onChangeText={setOverrideReason} placeholder="Required reason" style={styles.input} /> : null}</View> : null}
      <View style={styles.feeCard}><Text style={styles.feeLabel}>Fee</Text><Text style={styles.fee}>₹{feeAmount ?? '—'}</Text></View>
      <AppButton label="Review Booking" disabled={!patient.data || !doctorId || !sessionDefinitionId || !appointmentTime || (overrideEnabled && overrideReason.trim().length < 2)} onPress={() => router.push({ pathname: '/assistant/appointments/review', params: { patientId, doctorId, sessionDefinitionId, appointmentDate: date, appointmentTime, appointmentType, overrideEnabled: overrideEnabled ? '1' : '0', overrideReason, followupId: followupId ?? '' } })} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 3 }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, copy: { flex: 1, gap: 3 }, title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark }, subtitle: { color: colors.muted, lineHeight: 19, fontSize: 13 }, empty: { color: colors.muted, fontSize: 13 }, label: { fontWeight: '700', color: colors.text }, input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 14, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.surface }, chipActive: { backgroundColor: colors.softPrimary, borderColor: '#C8DCF9' }, chipText: { color: colors.muted, fontWeight: '600' }, chipTextActive: { color: colors.primaryDark, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }, cardSelected: { borderColor: colors.primary, backgroundColor: '#FBFDFF' }, disabledCard: { opacity: 0.5 }, cardTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 16 }, success: { color: colors.success, fontWeight: '700', fontSize: 12 }, danger: { color: colors.danger, fontWeight: '700', fontSize: 12 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, slot: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSoft, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 }, slotDisabled: { opacity: 0.35 }, slotSelected: { backgroundColor: colors.primary, borderColor: colors.primary }, slotText: { color: colors.text, fontWeight: '600', fontSize: 12 }, slotSelectedText: { color: colors.surface, fontWeight: '800', fontSize: 12 },
  feeCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.softPrimary, padding: spacing.md, borderRadius: radius.lg }, feeLabel: { color: colors.muted, fontWeight: '700' }, fee: { color: colors.primaryDark, fontSize: 23, fontWeight: '800' }, modalOverlay: { flex: 1, backgroundColor: 'rgba(10,45,98,0.28)', justifyContent: 'flex-end' }, modalContent: { backgroundColor: colors.background, padding: spacing.lg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '80%', gap: spacing.md }, modalTitle: { fontSize: 22, fontWeight: '800', color: colors.primaryDark },
});
