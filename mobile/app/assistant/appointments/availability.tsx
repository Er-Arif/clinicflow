import { QueryState } from '@/components/QueryState';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useClinicTimeQuery, useGetAvailabilityQuery, useListDoctorsQuery } from '@/api/api';
import { DatePicker } from '@/components/DatePicker';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicTime, formatClinicTimeRange } from '@/utils/dates';

export default function AvailabilityScreen() {
  const clinicTime = useClinicTimeQuery();
  const [date, setDate] = useState('');
  useEffect(() => { if (!date && clinicTime.data?.clinic_date) setDate(clinicTime.data.clinic_date); }, [clinicTime.data?.clinic_date, date]);
  const doctors = useListDoctorsQuery();
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const doctorId = selectedDoctor ?? doctors.data?.[0]?.doctor_id ?? '';
  const availability = useGetAvailabilityQuery({ doctorId, date }, { skip: !doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(date) });
  return <KeyboardSafeFormScreen><QueryState query={clinicTime} label="clinic date" /><QueryState query={availability} label="availability" /><BackButton />
    <View style={styles.header}><Text style={styles.title}>Availability</Text><Text style={styles.subtitle}>Sessions and booking slots</Text></View>
    <Text style={styles.label}>Doctor</Text><View style={styles.chips}>{doctors.data?.map(doctor => <Pressable key={doctor.doctor_id} onPress={() => setSelectedDoctor(doctor.doctor_id)} style={[styles.chip, doctorId === doctor.doctor_id && styles.chipActive]}><Text style={doctorId === doctor.doctor_id ? styles.chipTextActive : styles.chipText}>{doctor.display_name}</Text></Pressable>)}</View>
    <Text style={styles.label}>Date</Text><DatePicker value={date} onChange={setDate} placeholder="Select date" />
    {!availability.isFetching && !availability.isError && availability.data?.sessions.length === 0 ? <View style={styles.emptyCard}><Text style={styles.cardTitle}>No session available</Text><Text style={styles.subtitle}>Choose another date.</Text></View> : null}
    {availability.data?.sessions.map(session => <View key={session.session_definition_id} style={styles.card}><View style={styles.row}><View style={styles.copy}><Text style={styles.cardTitle}>{session.name}</Text><Text style={styles.subtitle}>{formatClinicTimeRange(session.start_time, session.end_time)} · {session.slot_interval_minutes} min</Text></View><Text style={session.status === 'BLOCKED' ? styles.blocked : styles.available}>{session.status === 'BLOCKED' ? 'Blocked' : `${session.remaining_capacity} free`}</Text></View>{session.blocked_reason ? <Text style={styles.error}>{session.blocked_reason}</Text> : null}<View style={styles.slots}>{session.slots.map(slot => <View key={slot.time} style={[styles.slot, !slot.normal_booking_allowed && styles.slotDisabled]}><Text style={!slot.normal_booking_allowed ? styles.muted : styles.slotText}>{formatClinicTime(slot.time)}</Text></View>)}</View></View>)}
  </KeyboardSafeFormScreen>;
}
const styles = StyleSheet.create({ header: { gap: 3 }, row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, copy: { flex: 1, gap: 3 }, title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark }, subtitle: { color: colors.muted, lineHeight: 19, fontSize: 13 }, label: { fontWeight: '700', color: colors.text }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.surface }, chipActive: { backgroundColor: colors.softPrimary, borderColor: '#C8DCF9' }, chipText: { color: colors.muted, fontWeight: '600' }, chipTextActive: { color: colors.primaryDark, fontWeight: '800' }, card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm }, emptyCard: { backgroundColor: colors.surfaceSoft, borderRadius: radius.lg, padding: spacing.md, gap: 3 }, cardTitle: { color: colors.primaryDark, fontSize: 16, fontWeight: '800' }, available: { color: colors.success, fontWeight: '700', fontSize: 12 }, blocked: { color: colors.danger, fontWeight: '700', fontSize: 12 }, error: { color: colors.danger }, slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, slot: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSoft, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 }, slotDisabled: { opacity: 0.4 }, slotText: { color: colors.text, fontWeight: '600', fontSize: 12 }, muted: { color: colors.muted, fontSize: 12 } });
