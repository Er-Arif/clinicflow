import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useGetDoctorTodayQuery, useMeQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { MetricCard } from '@/components/MetricCard';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate } from '@/utils/dates';

export default function DoctorToday() {
  const router = useRouter();
  const me = useMeQuery();
  const today = useGetDoctorTodayQuery();
  const owner = me.data?.permissions.includes('reports.view') ?? false;

  return (
    <AppScreen refreshing={today.isFetching} onRefresh={() => void today.refetch()}>
      <Text style={styles.eyebrow}>ClinicFlow</Text>
      <Text style={styles.title}>Today</Text>
      <Text style={styles.subtitle}>{today.data ? formatClinicDate(today.data.date) : 'Loading clinic day…'}</Text>

      {today.isLoading ? <ActivityIndicator /> : null}
      {today.isError ? <Text style={styles.error}>Unable to load today's patients.</Text> : null}

      {today.data ? (
        <>
          <View style={styles.metrics}>
            <MetricCard label="Appointments" value={today.data.total_appointments} />
            <MetricCard label="Checked In" value={today.data.checked_in_count} />
            <MetricCard label="Upcoming" value={today.data.upcoming_count} />
          </View>

          <Section title={`Checked In · ${today.data.checked_in_count}`} empty="No patients are checked in right now.">
            {today.data.checked_in.map((item) => (
              <PatientCard key={item.appointment_id} item={item} onPress={() => router.push(`/(doctor)/patients/${item.patient_id}`)} active />
            ))}
          </Section>

          <Section title={`Upcoming · ${today.data.upcoming_count}`} empty="No upcoming booked patients.">
            {today.data.upcoming.map((item) => (
              <PatientCard key={item.appointment_id} item={item} onPress={() => router.push(`/(doctor)/patients/${item.patient_id}`)} />
            ))}
          </Section>

          <AppButton label="Patient Search" tone="secondary" onPress={() => router.push('/(doctor)/patients')} />

          {owner ? (
            <View style={styles.ownerActions}>
              <Text style={styles.sectionTitle}>Owner</Text>
              <AppButton label="Dashboard" onPress={() => router.push('/(doctor)/dashboard')} />
              <AppButton label="Reports" tone="secondary" onPress={() => router.push('/(doctor)/reports')} />
              <AppButton label="Settings" tone="secondary" onPress={() => router.push('/(doctor)/settings')} />
            </View>
          ) : null}
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
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.patient}>{item.patient_name}</Text>
          <Text style={styles.subtitle}>{item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular Consultation'}</Text>
          {active ? <Text style={styles.meta}>Payment {item.payment_status ?? 'PENDING'}</Text> : null}
        </View>
        <Text style={active ? styles.active : styles.time}>{item.appointment_time?.slice(0, 5) ?? 'Walk-in'}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.primary, fontWeight: '800' },
  title: { fontSize: 30, fontWeight: '900', color: colors.text },
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
  ownerActions: { marginTop: spacing.lg, gap: spacing.sm },
});
