import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { useGetDoctorTodayQuery, useListDoctorsQuery, useGetScheduleQuery } from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { ClinicHeader } from '@/components/ClinicHeader';
import { MetricCard } from '@/components/MetricCard';
import { QueryState } from '@/components/QueryState';
import { useClinicClock } from '@/features/reporting/useClinicClock';
import { todaySummary } from '@/features/reporting/today';
import { CLINIC_SYNC_INTERVAL } from '@/features/reporting/clinicClock';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicTime, formatClinicTimeRange } from '@/utils/dates';

export default function DoctorToday() {
  const router = useRouter();
  const { clock, query: clinicTime } = useClinicClock();
  const today = useGetDoctorTodayQuery({ date: clock?.date }, {
    skip: !clock, pollingInterval: CLINIC_SYNC_INTERVAL, skipPollingIfUnfocused: true, refetchOnMountOrArgChange: true,
  });
  const doctors = useListDoctorsQuery();
  const doctor = doctors.data?.[0];
  const schedule = useGetScheduleQuery({ doctorId: doctor?.doctor_id ?? '', effectiveOn: clock?.date }, { skip: !doctor || !clock });
  const weekday = clock ? (new Date(`${clock.date}T12:00:00Z`).getUTCDay() + 6) % 7 : -1;
  const sessions = schedule.currentData?.days.find(day => day.weekday === weekday && day.active)?.sessions.filter(session => session.active) ?? [];
  const summary = today.currentData && clock ? todaySummary(today.currentData, clock.date, clock.time) : null;
  const { refetch } = today;
  const hasClock = Boolean(clock);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && hasClock) void refetch();
    });
    return () => subscription.remove();
  }, [refetch, hasClock]);

  const refresh = () => {
    void clinicTime.refetch();
    if (clock) void today.refetch();
    if (doctor && clock) void schedule.refetch();
  };

  const firstName = doctor?.display_name?.trim().split(/\s+/)[0];
  const openDetails = (view: 'all' | 'checked_in' | 'upcoming') => {
    if (!clock) return;
    router.push({ pathname: '/doctor/today-details', params: { date: clock.date, view } });
  };

  return (
    <AppScreen refreshing={today.isFetching} onRefresh={refresh}>
      <ClinicHeader
        title="Today"
        subtitle={`${clock?.greeting ?? 'Welcome'}${firstName ? `, ${firstName}` : ''}`}
        displayTime={clock?.displayTime}
        compactDate={clock?.compactDate}
      />
      <QueryState query={clinicTime} label="clinic time" />
      <QueryState query={today} label="today's appointments" hasData={Boolean(summary)} />

      {summary ? (
        <>
          <View style={styles.metrics}>
            <MetricCard compact label="Total" value={summary.appointments} onPress={() => openDetails('all')} accessibilityLabel={`View all ${summary.appointments} appointments today`} />
            <MetricCard compact label="Checked in" value={summary.checkedInCount} onPress={() => openDetails('checked_in')} accessibilityLabel={`View ${summary.checkedInCount} checked-in patients`} />
            <MetricCard compact label="Upcoming" value={summary.upcomingCount} onPress={() => openDetails('upcoming')} accessibilityLabel={`View ${summary.upcomingCount} upcoming appointments`} />
          </View>

          {sessions.length > 0 ? (
            <View style={styles.sessions}>
              {sessions.map(session => (
                <View key={session.session_definition_id} style={styles.sessionChip}>
                  <Text style={styles.sessionName}>{session.session_name}</Text>
                  <Text style={styles.sessionTime}>{formatClinicTimeRange(session.start_time, session.end_time)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <QueryState query={schedule} label="today's sessions" />

          <Section title={`Checked in · ${summary.checkedInCount}`} empty="No patients checked in.">
            {summary.checkedIn.map(item => (
              <PatientCard key={item.appointment_id} item={item} onPress={() => router.push(`/doctor/patients/${item.patient_id}`)} active />
            ))}
          </Section>

          <Section title={`Upcoming · ${summary.upcomingCount}`} empty="No upcoming appointments.">
            {summary.upcoming.map(item => (
              <PatientCard key={item.appointment_id} item={item} onPress={() => router.push(`/doctor/patients/${item.patient_id}`)} />
            ))}
          </Section>
        </>
      ) : null}
    </AppScreen>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.some(Boolean) ? children : <Text style={styles.empty}>{empty}</Text>}
    </View>
  );
}

function PatientCard({ item, onPress, active = false }: { item: { patient_name: string; appointment_time: string | null; appointment_type: string; payment_status: string | null }; onPress: () => void; active?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.patient_name}`} style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.row}>
        <View style={styles.patientCopy}>
          <Text style={styles.patient}>{item.patient_name}</Text>
          <Text style={styles.meta}>{item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular consultation'}</Text>
        </View>
        <View style={styles.cardRight}>
          <Text style={active ? styles.active : styles.time}>{active ? 'Checked in' : item.appointment_time ? formatClinicTime(item.appointment_time) : 'Walk-in'}</Text>
          {active && item.payment_status ? <Text style={styles.payment}>{item.payment_status === 'CONFIRMED' ? 'Paid' : 'Payment pending'}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', gap: spacing.sm },
  sessions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sessionChip: { backgroundColor: colors.softPrimary, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8, gap: 2, borderWidth: 1, borderColor: colors.border },
  sessionName: { fontWeight: '700', color: colors.primaryDark, fontSize: 13 },
  sessionTime: { color: colors.muted, fontSize: 12 },
  section: { gap: spacing.sm, marginTop: spacing.xs },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.primaryDark },
  empty: { color: colors.muted, fontSize: 13, paddingVertical: spacing.xs },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  pressed: { opacity: 0.78 },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  patientCopy: { flex: 1, gap: 3 },
  patient: { fontSize: 16, fontWeight: '800', color: colors.text },
  meta: { color: colors.muted, fontSize: 13 },
  cardRight: { alignItems: 'flex-end', gap: 3 },
  active: { color: colors.success, fontWeight: '700', fontSize: 13 },
  time: { color: colors.primaryDark, fontWeight: '800', fontSize: 14 },
  payment: { color: colors.muted, fontSize: 11 },
});
