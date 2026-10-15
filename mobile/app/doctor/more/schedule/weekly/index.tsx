import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useGetScheduleOverviewQuery, useListDoctorsQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import type { ScheduleDay } from '@/features/scheduling/types';
import { dateLabel, isWorking } from '@/features/scheduling/weeklyEditor';
import { colors, radius, spacing } from '@/theme/tokens';

function Hours({ day }: { day: ScheduleDay | null }) {
  if (!isWorking(day)) return <Text style={styles.hint}>Day off</Text>;
  return <>{day!.sessions.filter(s => s.active).sort((a, b) => a.display_order - b.display_order).map(session => (
    <View key={session.session_definition_id} style={styles.session}>
      <Text style={styles.heading}>{session.session_name}</Text>
      <Text style={styles.hint}>{session.start_time.slice(0, 5)} – {session.end_time.slice(0, 5)} · {session.slot_interval_minutes} min · Capacity {session.maximum_capacity}</Text>
    </View>
  ))}</>;
}

export default function WeeklyScheduleIndexScreen() {
  const router = useRouter();
  const { saved, doctorId: requestedDoctor } = useLocalSearchParams<{ saved?: string; doctorId?: string }>();
  const doctors = useListDoctorsQuery();
  const doctor = doctors.data?.find(d => d.doctor_id === requestedDoctor) ?? doctors.data?.[0];
  const doctorId = doctor?.doctor_id ?? '';
  const overview = useGetScheduleOverviewQuery(doctorId, { skip: !doctorId, refetchOnMountOrArgChange: true });
  const edit = (weekday?: number) => router.push({ pathname: '/doctor/more/schedule/weekly/edit', params: {
    doctorId, ...(weekday === undefined ? {} : { weekday: String(weekday) }),
  } });
  const retry = () => { if (doctorId) void overview.refetch(); else void doctors.refetch(); };
  return (
    <AppScreen refreshing={overview.isFetching} onRefresh={retry}>
      <BackButton />
      <Text accessibilityRole="header" style={styles.title}>Weekly Working Hours</Text>
      {doctor ? <Text style={styles.hint}>{doctor.display_name}</Text> : null}
      {saved === '1' ? <Text accessibilityRole="alert" style={styles.success}>Weekly schedule updated.</Text> : null}
      <AppButton label="Edit weekly schedule" disabled={!overview.data || overview.isFetching || overview.isError} onPress={() => edit()} />
      {doctors.isError || overview.isError ? <>
        <Text style={styles.error}>Unable to refresh weekly hours. Retry to see the latest schedule.</Text>
        <AppButton label="Retry" tone="secondary" onPress={retry} />
      </> : overview.isFetching || doctors.isLoading ? <Text style={styles.hint}>Loading weekly hours…</Text>
        : !doctorId ? <Text style={styles.hint}>No doctor is configured.</Text>
        : overview.data?.days.map(day => (
          <View key={day.weekday} style={styles.card}>
            <Text style={styles.heading}>{day.weekday_name}</Text>
            <Hours day={day.current} />
            {day.upcoming ? <View style={styles.planned}>
              <Text style={styles.heading}>Planned {isWorking(day.upcoming) ? 'hours' : 'day off'} from {dateLabel(day.upcoming.effective_from)}</Text>
              <Hours day={day.upcoming} />
            </View> : null}
            <AppButton label={`Edit ${day.weekday_name}`} tone="secondary" onPress={() => edit(day.weekday)} />
          </View>
        ))}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  heading: { fontSize: 16, fontWeight: '600', color: colors.text },
  hint: { fontSize: 14, color: colors.muted, lineHeight: 21 },
  card: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  session: { gap: spacing.xs },
  planned: { padding: spacing.sm, gap: spacing.sm, backgroundColor: colors.softPrimary, borderRadius: radius.sm },
  success: { color: colors.success, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
});
