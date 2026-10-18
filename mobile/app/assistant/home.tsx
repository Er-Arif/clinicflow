import { QueryState } from '@/components/QueryState';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useGetAssistantHomeQuery, useMeQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { ClinicHeader } from '@/components/ClinicHeader';
import { MetricCard } from '@/components/MetricCard';
import { useClinicClock } from '@/features/reporting/useClinicClock';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicTime } from '@/utils/dates';

export default function AssistantHome() {
  const router = useRouter();
  const home = useGetAssistantHomeQuery();
  const me = useMeQuery();
  const { clock, query: clinicTime } = useClinicClock();
  const data = home.data;
  const refresh = () => { void home.refetch(); void clinicTime.refetch(); };
  const firstName = me.data?.display_name?.trim().split(/\s+/)[0];

  return (
    <AppScreen refreshing={home.isFetching} onRefresh={refresh}>
      <ClinicHeader
        title="Today"
        subtitle={`${clock?.greeting ?? 'Welcome'}${firstName ? `, ${firstName}` : ''}`}
        displayTime={clock?.displayTime}
        compactDate={clock?.compactDate}
      />
      <QueryState query={clinicTime} label="clinic time" />
      <QueryState query={home} label="clinic activity" />

      {data ? (
        <>
          <View style={styles.metrics}>
            <MetricCard label="Appointments" value={data.appointments} />
            <MetricCard label="Checked in" value={data.checked_in} />
            <MetricCard label="Completed" value={data.completed} />
            <MetricCard label="Cancelled" value={data.cancelled} />
          </View>

          <View style={styles.primaryActions}>
            <AppButton style={styles.actionButton} label="New Appointment" onPress={() => router.push('/assistant/patients')} />
            <AppButton style={styles.actionButton} label="Add Walk-in" tone="secondary" onPress={() => router.push('/assistant/walk-in')} />
          </View>

          <View style={styles.attention}>
            <Text style={styles.sectionTitle}>Needs attention</Text>
            <AttentionRow label="Payments" value={data.pending_payments} onPress={() => router.push('/assistant/payments')} />
            <AttentionRow label="Reminders" value={data.due_reminders} onPress={() => router.push('/assistant/reminders')} />
            <AttentionRow label="Follow-ups" value={data.overdue_followups} onPress={() => router.push('/assistant/followups')} />
          </View>

          <Section title="Next appointments" empty="No upcoming appointments.">
            {data.next_appointments.map(item => (
              <Pressable
                accessibilityRole="button"
                key={item.appointment_id}
                style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}
                onPress={() => router.push(`/assistant/appointments/${item.appointment_id}`)}
              >
                <View style={styles.rowCopy}>
                  <Text style={styles.name}>{item.patient_name}</Text>
                  <Text style={styles.meta}>{item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular consultation'}</Text>
                </View>
                <Text style={styles.time}>{item.appointment_time ? formatClinicTime(item.appointment_time) : 'Walk-in'}</Text>
              </Pressable>
            ))}
          </Section>

          <Section title={`Checked in · ${data.checked_in}`} empty="No patients checked in.">
            {data.checked_in_patients.map(item => (
              <Pressable
                accessibilityRole="button"
                key={item.appointment_id}
                style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}
                onPress={() => router.push(`/assistant/appointments/${item.appointment_id}`)}
              >
                <View style={styles.rowCopy}>
                  <Text style={styles.name}>{item.patient_name}</Text>
                  <Text style={styles.meta}>{item.payment_status === 'CONFIRMED' ? 'Paid' : 'Payment pending'}</Text>
                </View>
                <Text style={styles.checkedIn}>Checked in</Text>
              </Pressable>
            ))}
          </Section>

          {data.checked_in > data.checked_in_patients.length ? (
            <AppButton label="View all appointments" compact tone="secondary" onPress={() => router.push('/assistant/appointments')} />
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
      {items.some(Boolean) ? children : <Text style={styles.empty}>{empty}</Text>}
    </View>
  );
}

function AttentionRow({ label, value, onPress }: { label: string; value: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.attentionRow, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.name}>{label}</Text>
      <View style={[styles.count, value > 0 && styles.countAlert]}>
        <Text style={[styles.countText, value > 0 && styles.countAlertText]}>{value}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  primaryActions: { flexDirection: 'row', gap: spacing.sm },
  actionButton: { flex: 1 },
  section: { gap: spacing.sm, marginTop: spacing.xs },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.primaryDark },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md },
  rowCopy: { flex: 1, gap: 3 },
  name: { fontWeight: '700', color: colors.text, fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12 },
  time: { fontWeight: '800', color: colors.primaryDark, fontSize: 14 },
  checkedIn: { fontWeight: '700', color: colors.success, fontSize: 13 },
  attention: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: 0 },
  attentionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 40, paddingVertical: 3 },
  count: { minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft },
  countAlert: { backgroundColor: colors.softWarning },
  countText: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  countAlertText: { color: colors.warning },
  empty: { color: colors.muted, fontSize: 13, paddingVertical: spacing.xs },
  pressed: { opacity: 0.78 },
});
