import { QueryState } from '@/components/QueryState';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';

import { useClinicTimeQuery, useListAppointmentsQuery } from '@/api/api';
import { DatePicker } from '@/components/DatePicker';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicTime } from '@/utils/dates';

const FILTER_STATUSES = ['BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'] as const;
type AppointmentStatusFilter = (typeof FILTER_STATUSES)[number];

function statusLabel(value: string) {
  return value === 'CHECKED_IN' ? 'Checked in' : value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');
}

function routeStatus(value?: string): AppointmentStatusFilter | undefined {
  return FILTER_STATUSES.includes(value as AppointmentStatusFilter) ? value as AppointmentStatusFilter : undefined;
}

export default function AppointmentsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ status?: string }>();
  const clinicTime = useClinicTimeQuery();
  const requestedStatus = routeStatus(params.status);
  const [dateInput, setDate] = useState('');
  const [status, setStatus] = useState<AppointmentStatusFilter | undefined>(requestedStatus);
  const date = dateInput || clinicTime.data?.clinic_date || '';

  useEffect(() => {
    setStatus(requestedStatus);
  }, [requestedStatus]);

  useEffect(() => {
    const unsub = navigation.getParent()?.addListener('blur', () => {
      setStatus(undefined);
      if (clinicTime.data?.clinic_date) setDate(clinicTime.data.clinic_date);
    });
    return unsub;
  }, [navigation, clinicTime.data?.clinic_date]);

  const appointments = useListAppointmentsQuery({ date, status }, { skip: !date });

  return (
    <AppScreen refreshing={appointments.isFetching} onRefresh={() => { if (date) void appointments.refetch(); else void clinicTime.refetch(); }}>
      <View style={styles.header}>
        <Text style={styles.title}>Appointments</Text>
        <Text style={styles.subtitle}>Daily bookings and check-ins</Text>
      </View>
      <DatePicker value={date} onChange={setDate} placeholder="Select date" />
      <View style={styles.chips}>
        {([undefined, ...FILTER_STATUSES] as const).map(value => (
          <Pressable accessibilityRole="button" accessibilityState={{ selected: status === value }} key={value ?? 'ALL'} onPress={() => setStatus(value)} style={[styles.chip, status === value && styles.chipActive]}>
            <Text style={status === value ? styles.chipTextActive : styles.chipText}>{value ? statusLabel(value) : 'All'}</Text>
          </Pressable>
        ))}
      </View>
      <QueryState query={clinicTime} label="clinic date" />
      <QueryState query={appointments} label="appointments" hasData={Boolean(appointments.currentData)} empty={appointments.currentData?.items.length === 0 ? 'No appointments found.' : undefined} />

      <View style={styles.list}>
        {appointments.currentData?.items.map(item => (
          <Pressable key={item.appointment_id} style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={() => router.push(`/assistant/appointments/${item.appointment_id}`)}>
            <View style={styles.row}>
              <View style={styles.copy}>
                <Text style={styles.name}>{item.patient.full_name}</Text>
                <Text style={styles.subtitle}>{item.appointment_time ? formatClinicTime(item.appointment_time) : 'Walk-in'} · {item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular'}</Text>
              </View>
              <View style={[styles.statusPill, item.status === 'CHECKED_IN' && styles.statusChecked, item.status === 'CANCELLED' && styles.statusMuted]}>
                <Text style={[styles.statusText, item.status === 'CHECKED_IN' && styles.statusCheckedText, item.status === 'CANCELLED' && styles.statusMutedText]}>{statusLabel(item.status)}</Text>
              </View>
            </View>
          </Pressable>
        ))}
      </View>
      <AppButton label="New appointment" onPress={() => router.push('/assistant/patients')} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 3 }, row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' }, copy: { flex: 1, gap: 3 },
  title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark }, subtitle: { color: colors.muted, lineHeight: 19, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.softPrimary, borderColor: '#C8DCF9' }, chipText: { color: colors.muted, fontWeight: '600' }, chipTextActive: { color: colors.primaryDark, fontWeight: '800' },
  list: { gap: spacing.sm }, card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md }, pressed: { opacity: 0.78 },
  name: { fontSize: 16, fontWeight: '800', color: colors.text }, statusPill: { backgroundColor: colors.softSuccess, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }, statusText: { color: colors.success, fontWeight: '700', fontSize: 11 },
  statusChecked: { backgroundColor: colors.softPrimary }, statusCheckedText: { color: colors.primary }, statusMuted: { backgroundColor: colors.surfaceSoft }, statusMutedText: { color: colors.muted },
});
