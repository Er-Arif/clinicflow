import { useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';

import { useGetDoctorTodayQuery, useListDoctorsQuery, useGetScheduleQuery } from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { MetricCard } from '@/components/MetricCard';
import { colors, radius, spacing } from '@/theme/tokens';
import { QueryState } from '@/components/QueryState';
import { useClinicClock } from '@/features/reporting/useClinicClock';
import { todaySummary } from '@/features/reporting/today';
import { CLINIC_SYNC_INTERVAL } from '@/features/reporting/clinicClock';

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
  const refresh = () => { void clinicTime.refetch(); if (clock) void today.refetch(); if (doctor && clock) void schedule.refetch(); };

  return (
    <AppScreen refreshing={today.isFetching} onRefresh={refresh}>
      <Text style={styles.title}>Today</Text>
      <Text style={styles.greeting}>{clock?.greeting ?? 'Welcome'}{doctor ? `, ${doctor.display_name}` : ''}</Text>
      {clock ? <View style={styles.clockCard}>
        <Text style={styles.subtitle}>{clock.readableDate}</Text>
        <Text accessibilityLabel={`Clinic time ${clock.time}`} style={styles.clock}>{clock.time}</Text>
        <Text style={styles.subtitle}>{clinicTime.data?.timezone}</Text>
      </View> : null}
      <QueryState query={clinicTime} label="clinic time" />
      <QueryState query={today} label="today's appointments" hasData={Boolean(summary)} />

      {summary ? (
        <>
          <View style={styles.metrics}>
            <MetricCard label="Appointments" value={summary.appointments} />
            <MetricCard label="Checked In" value={summary.checkedInCount} />
            <MetricCard label="Upcoming" value={summary.upcomingCount} />
          </View>

          {sessions.length > 0 ? <View style={styles.sessions}>{sessions.map(session => <View key={session.session_definition_id} style={styles.sessionChip}>
            <Text style={styles.sessionName}>{session.session_name}</Text>
            <Text style={styles.subtitle}>{session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)}</Text>
          </View>)}</View> : null}
          <QueryState query={schedule} label="today's sessions" />
          {summary.appointments === 0 && !today.isError ? <Text style={styles.subtitle}>No appointments today.</Text> : null}
          {summary.checkedInCount > summary.checkedIn.length || summary.upcomingCount > summary.upcoming.length
            ? <Text style={styles.subtitle}>Showing the first 100 patients in each section. Totals include all matching appointments.</Text> : null}
          <Section title={`Checked In · ${summary.checkedInCount}`} empty="No patients are checked in right now.">
            {summary.checkedIn.map((item) => (
              <PatientCard key={item.appointment_id} item={item} onPress={() => router.push(`/doctor/patients/${item.patient_id}`)} active />
            ))}
          </Section>

          <Section title={`Upcoming · ${summary.upcomingCount}`} empty="No future booked appointments today.">
            {summary.upcoming.map((item) => (
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
      {items.some(Boolean) ? children : <Text style={styles.subtitle}>{empty}</Text>}
    </View>
  );
}

function PatientCard({ item, onPress, active = false }: { item: { patient_name: string; appointment_time: string | null; appointment_type: string; payment_status: string | null }; onPress: () => void; active?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`View ${item.patient_name}`} style={styles.card} onPress={onPress}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.patient}>{item.patient_name}</Text>
          <Text style={styles.subtitle}>{item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular Consultation'}</Text>
          <Text style={styles.meta}>{active ? 'Checked in' : 'Booked'} · View patient</Text>
        </View>
        <Text style={active ? styles.active : styles.time}>{item.appointment_time?.slice(0, 5) ?? 'Walk-in'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.primary, fontWeight: '800' },
  greeting: { fontSize: 16, color: colors.text },
  clockCard: { gap: spacing.xs },
  clock: { fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.primary },
  sessions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sessionChip: { backgroundColor: colors.softPrimary, borderRadius: radius.md, padding: spacing.sm },
  sessionName: { fontWeight: '700', color: colors.primary },
  title: { fontSize: 24, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger, fontWeight: '700' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  patient: { fontSize: 17, fontWeight: '900', color: colors.text },
  meta: { color: colors.muted, fontSize: 13, marginTop: 3 },
  active: { color: colors.primary, fontWeight: '900' },
  time: { color: colors.text, fontWeight: '900' },
});

