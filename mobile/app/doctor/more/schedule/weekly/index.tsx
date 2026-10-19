import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useGetScheduleOverviewQuery, useListDoctorsQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import type { ScheduleDay } from '@/features/scheduling/types';
import { dateLabel, isWorking } from '@/features/scheduling/weeklyEditor';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicTimeRange } from '@/utils/dates';

function Hours({ day }: { day: ScheduleDay | null }) {
  if (!isWorking(day)) return <Text style={styles.hint}>Day off</Text>;
  return <>{day!.sessions.filter(s => s.active).sort((a, b) => a.display_order - b.display_order).map(session => (
    <View key={session.session_definition_id} style={styles.session}>
      <Text style={styles.heading}>{session.session_name}</Text>
      <Text style={styles.hint}>{formatClinicTimeRange(session.start_time, session.end_time)} · {session.slot_interval_minutes} min · Capacity {session.maximum_capacity}</Text>
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
  const edit = (weekday?: number) => router.push({ pathname: '/doctor/more/schedule/weekly/edit', params: { doctorId, ...(weekday === undefined ? {} : { weekday: String(weekday) }) } });
  const retry = () => { if (doctorId) void overview.refetch(); else void doctors.refetch(); };

  return (
    <AppScreen refreshing={overview.isFetching} onRefresh={retry}>
      <BackButton />
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Weekly hours</Text>
        {doctor ? <Text style={styles.hint}>{doctor.display_name}</Text> : null}
      </View>
      {saved === '1' ? <Text accessibilityRole="alert" style={styles.success}>Weekly schedule updated</Text> : null}
      <AppButton label="Edit weekly schedule" disabled={!overview.data || overview.isFetching || overview.isError} onPress={() => edit()} />
      {doctors.isError || overview.isError ? <>
        <Text style={styles.error}>Unable to refresh weekly hours.</Text>
        <AppButton label="Retry" tone="secondary" onPress={retry} />
      </> : overview.isFetching || doctors.isLoading ? <Text style={styles.hint}>Loading weekly hours…</Text>
        : !doctorId ? <Text style={styles.hint}>No doctor is configured.</Text>
        : overview.data?.days.map(day => (
          <View key={day.weekday} style={styles.card}>
            <Text style={styles.day}>{day.weekday_name}</Text>
            <Hours day={day.current} />
            {day.upcoming ? (
              <View style={styles.planned}>
                <Text style={styles.heading}>{isWorking(day.upcoming) ? `Planned hours from ${dateLabel(day.upcoming.effective_from)}` : `Planned day off from ${dateLabel(day.upcoming.effective_from)}`}</Text>
                <Hours day={day.upcoming} />
              </View>
            ) : null}
            <AppButton compact label={`Edit ${day.weekday_name}`} tone="secondary" onPress={() => edit(day.weekday)} />
          </View>
        ))}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 3 },
  title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark },
  day: { fontSize: 17, fontWeight: '800', color: colors.primaryDark },
  heading: { fontSize: 14, fontWeight: '700', color: colors.text },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  card: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg },
  session: { gap: 3 },
  planned: { padding: spacing.sm, gap: spacing.sm, backgroundColor: colors.softPrimary, borderRadius: radius.md },
  success: { color: colors.success, fontSize: 13, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13 },
});
