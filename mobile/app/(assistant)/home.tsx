import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useGetAssistantHomeQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { MetricCard } from '@/components/MetricCard';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate } from '@/utils/dates';

export default function AssistantHome() {
  const router = useRouter();
  const home = useGetAssistantHomeQuery();
  const data = home.data;

  return (
    <AppScreen refreshing={home.isFetching} onRefresh={() => void home.refetch()}>
      <Text style={styles.eyebrow}>ClinicFlow</Text>
      <Text style={styles.title}>Today</Text>
      <Text style={styles.subtitle}>{data ? formatClinicDate(data.clinic_date) : 'Loading clinic day…'}</Text>

      {home.isLoading ? <ActivityIndicator /> : null}
      {home.isError ? <Text style={styles.error}>Unable to load today's clinic activity.</Text> : null}

      {data ? (
        <>
          <View style={styles.metrics}>
            <MetricCard label="Appointments" value={data.appointments} />
            <MetricCard label="Checked In" value={data.checked_in} />
            <MetricCard label="Completed" value={data.completed} />
            <MetricCard label="Cancelled" value={data.cancelled} />
          </View>

          <View style={styles.primaryActions}>
            <AppButton label="New Appointment" onPress={() => router.push('/(assistant)/patients')} />
            <AppButton label="Walk-in" tone="secondary" onPress={() => router.push('/(assistant)/walk-in')} />
          </View>

          <Section title="Next Appointments" empty="No upcoming booked appointments today.">
            {data.next_appointments.map((item) => (
              <Pressable
                key={item.appointment_id}
                style={styles.rowCard}
                onPress={() => router.push(`/(assistant)/appointments/${item.appointment_id}`)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.patient_name}</Text>
                  <Text style={styles.subtitle}>{item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular Consultation'}</Text>
                </View>
                <Text style={styles.time}>{item.appointment_time?.slice(0, 5) ?? 'Walk-in'}</Text>
              </Pressable>
            ))}
          </Section>

          <Section title="Checked In" empty="No patient is currently checked in.">
            {data.checked_in_patients.map((item) => (
              <Pressable
                key={item.appointment_id}
                style={styles.rowCard}
                onPress={() => router.push(`/(assistant)/appointments/${item.appointment_id}`)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.patient_name}</Text>
                  <Text style={styles.subtitle}>Payment {item.payment_status ?? 'PENDING'}</Text>
                </View>
                <Text style={styles.active}>CHECKED IN</Text>
              </Pressable>
            ))}
          </Section>

          <View style={styles.attention}>
            <Text style={styles.sectionTitle}>Attention</Text>
            <AttentionRow label="Pending payments today" value={data.pending_payments} onPress={() => router.push('/(assistant)/payments')} />
            <AttentionRow label="Due reminders" value={data.due_reminders} onPress={() => router.push('/(assistant)/reminders')} />
            <AttentionRow label="Overdue follow-ups" value={data.overdue_followups} onPress={() => router.push('/(assistant)/followups')} />
          </View>

          <View style={styles.actions}>
            <AppButton label="Today's Appointments" tone="secondary" onPress={() => router.push('/(assistant)/appointments')} />
            <AppButton label="Patient Search" tone="secondary" onPress={() => router.push('/(assistant)/patients')} />
          </View>
        </>
      ) : null}
    </AppScreen>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.some(Boolean);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hasItems ? children : <Text style={styles.subtitle}>{empty}</Text>}
    </View>
  );
}

function AttentionRow({ label, value, onPress }: { label: string; value: number; onPress: () => void }) {
  return (
    <Pressable style={styles.attentionRow} onPress={onPress}>
      <Text style={styles.name}>{label}</Text>
      <Text style={value > 0 ? styles.warning : styles.mutedStrong}>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: colors.primary, fontWeight: '800' },
  title: { fontSize: 30, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger, fontWeight: '700' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  primaryActions: { gap: spacing.sm },
  section: { gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
  },
  name: { fontWeight: '800', color: colors.text },
  time: { fontWeight: '900', color: colors.primary },
  active: { fontWeight: '900', color: colors.primary, fontSize: 12 },
  attention: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  attentionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  warning: { color: colors.warning, fontWeight: '900', fontSize: 18 },
  mutedStrong: { color: colors.muted, fontWeight: '900', fontSize: 18 },
  actions: { gap: spacing.sm },
});
