import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useGetDoctorTodayDetailsQuery, type DoctorTodayDetailView } from '@/api/doctorTodayDetails';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { QueryState } from '@/components/QueryState';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate, formatClinicTime } from '@/utils/dates';

const titles: Record<DoctorTodayDetailView, string> = {
  all: "Today's appointments",
  checked_in: 'Checked-in patients',
  upcoming: 'Upcoming appointments',
};

export default function DoctorTodayDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; view?: string }>();
  const date = String(params.date ?? '');
  const view = (['all', 'checked_in', 'upcoming'].includes(String(params.view)) ? String(params.view) : 'all') as DoctorTodayDetailView;
  const details = useGetDoctorTodayDetailsQuery({ date, view }, { skip: !/^\d{4}-\d{2}-\d{2}$/.test(date) });

  return (
    <AppScreen refreshing={details.isFetching} onRefresh={() => details.refetch()}>
      <BackButton />
      <View style={styles.header}>
        <Text style={styles.title}>{titles[view]}</Text>
        <Text style={styles.subtitle}>{formatClinicDate(date)}{details.data ? ` · ${details.data.total}` : ''}</Text>
      </View>
      <QueryState query={details} label="today's patient list" />

      {details.data?.items.length === 0 ? <Text style={styles.empty}>No patients in this list.</Text> : null}

      {details.data?.items.map(item => {
        const demographic = [item.age != null ? `${item.age} yrs` : null, formatGender(item.gender)].filter(Boolean).join(' · ');
        const time = item.appointment_time ? formatClinicTime(item.appointment_time) : 'Walk-in';
        return (
          <Pressable
            key={item.appointment_id}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.patient_name}`}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            onPress={() => router.push(`/doctor/patients/${item.patient_id}`)}
          >
            <View style={styles.topRow}>
              <View style={styles.copy}>
                <Text style={styles.name}>{item.patient_name}</Text>
                {demographic ? <Text style={styles.meta}>{demographic}</Text> : null}
              </View>
              <View style={styles.right}>
                <Text style={styles.time}>{time}</Text>
                <Text style={[styles.status, statusStyle(item.status)]}>{statusLabel(item.status)}</Text>
              </View>
            </View>
            <Text style={styles.contact}>{item.mobile_number}</Text>
            <Text style={styles.type}>{item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular consultation'}</Text>
          </Pressable>
        );
      })}
    </AppScreen>
  );
}

function formatGender(value: string) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function statusLabel(value: string) {
  if (value === 'CHECKED_IN') return 'Checked in';
  if (value === 'COMPLETED') return 'Completed';
  if (value === 'CANCELLED') return 'Cancelled';
  return 'Booked';
}

function statusStyle(value: string) {
  if (value === 'CHECKED_IN') return styles.statusChecked;
  if (value === 'COMPLETED') return styles.statusCompleted;
  if (value === 'CANCELLED') return styles.statusCancelled;
  return styles.statusBooked;
}

const styles = StyleSheet.create({
  header: { gap: 3 },
  title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, fontSize: 13 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: 5 },
  topRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  copy: { flex: 1, gap: 3 },
  right: { alignItems: 'flex-end', gap: 5 },
  name: { fontSize: 16, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.muted },
  contact: { fontSize: 13, color: colors.text },
  type: { fontSize: 12, color: colors.muted },
  time: { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
  status: { fontSize: 11, fontWeight: '700' },
  statusBooked: { color: colors.primary },
  statusChecked: { color: colors.success },
  statusCompleted: { color: colors.success },
  statusCancelled: { color: colors.danger },
  empty: { color: colors.muted, fontSize: 14, paddingVertical: spacing.sm },
  pressed: { opacity: 0.76 },
});
