import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';

import { useClinicTimeQuery, useListAppointmentsQuery } from '@/api/api';
import { DatePicker } from '@/components/DatePicker';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function AppointmentsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const clinicTime = useClinicTimeQuery();
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<string | undefined>();

  useEffect(() => {
    if (!date && clinicTime.data?.clinic_date) setDate(clinicTime.data.clinic_date);
  }, [clinicTime.data?.clinic_date, date]);

  useEffect(() => {
    const unsub = navigation.getParent()?.addListener('blur', () => {
      setStatus(undefined);
      if (clinicTime.data?.clinic_date) {
        setDate(clinicTime.data.clinic_date);
      }
    });
    return unsub;
  }, [navigation, clinicTime.data?.clinic_date]);

  const appointments = useListAppointmentsQuery({ date, status }, { skip: !date });

  return (
    <AppScreen>
      <View style={styles.row}>
        <View style={{ flex: 1 }}><Text style={styles.title}>Appointments</Text><Text style={styles.subtitle}>Bookings for the selected clinic date.</Text></View>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      </View>
      <DatePicker value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
      <View style={styles.chips}>
        {[undefined, 'BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'].map((value) => (
          <Pressable key={value ?? 'ALL'} onPress={() => setStatus(value)} style={[styles.chip, status === value && styles.chipActive]}>
            <Text style={status === value ? styles.chipTextActive : styles.chipText}>{value ?? 'ALL'}</Text>
          </Pressable>
        ))}
      </View>
      {appointments.isFetching ? <ActivityIndicator /> : null}
      {appointments.data?.items.map((item) => (
        <Pressable key={item.appointment_id} style={styles.card} onPress={() => router.push(`/assistant/appointments/${item.appointment_id}`)}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.patient.full_name}</Text>
              <Text style={styles.subtitle}>{item.appointment_time?.slice(0, 5)} · {item.appointment_type.replace('_', ' ')}</Text>
            </View>
            <Text style={item.status === 'CANCELLED' ? styles.cancelled : item.status === 'CHECKED_IN' ? styles.checkedIn : styles.booked}>{item.status.replace('_', ' ')}</Text>
          </View>
        </Pressable>
      ))}
      {!appointments.isFetching && appointments.data?.items.length === 0 ? <Text style={styles.subtitle}>No appointments found.</Text> : null}
      <AppButton label="New Appointment" onPress={() => router.push('/assistant/patients')} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '700', paddingTop: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: colors.softPrimary, borderColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: colors.primary, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  name: { fontSize: 17, fontWeight: '800', color: colors.text },
  booked: { color: colors.success, fontWeight: '800' },
  checkedIn: { color: colors.primary, fontWeight: '800' },
  cancelled: { color: colors.muted, fontWeight: '800' },
});


