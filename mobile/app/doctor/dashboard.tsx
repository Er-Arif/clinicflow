import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useClinicTimeQuery, useGetOwnerDashboardQuery } from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { MetricCard } from '@/components/MetricCard';
import { QueryState } from '@/components/QueryState';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate } from '@/utils/dates';

type DashboardPeriod = 'Today' | '7Days' | '30Days';

export default function OwnerDashboardScreen() {
  const clinicTime = useClinicTimeQuery();
  const [period, setPeriod] = useState<DashboardPeriod>('Today');
  const today = clinicTime.data?.clinic_date;
  const range = today ? dashboardRange(period, today) : { from: '', to: '' };
  const dashboard = useGetOwnerDashboardQuery(range, { skip: !today });
  const data = dashboard.currentData;
  const refresh = () => { if (today) void dashboard.refetch(); else void clinicTime.refetch(); };

  return (
    <AppScreen refreshing={dashboard.isFetching} onRefresh={refresh}>
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.subtitle}>Clinic snapshot</Text>
      </View>

      <QueryState query={clinicTime} label="clinic date" />
      <View style={styles.periods}>
        {(['Today', '7Days', '30Days'] as const).map(value => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: period === value }}
            onPress={() => setPeriod(value)}
            style={[styles.period, period === value && styles.periodActive]}
          >
            <Text style={[styles.periodText, period === value && styles.periodTextActive]}>
              {value === '7Days' ? 'Last 7 days' : value === '30Days' ? 'Last 30 days' : 'Today'}
            </Text>
          </Pressable>
        ))}
      </View>
      {today ? <Text style={styles.range}>{formatClinicDate(range.from)}{range.from !== range.to ? ` – ${formatClinicDate(range.to)}` : ''}</Text> : null}
      <QueryState query={dashboard} label="dashboard" hasData={Boolean(data)} />

      {data ? (
        <>
          <View style={styles.revenueCard}>
            <Text style={styles.revenueLabel}>Confirmed revenue</Text>
            <Text style={styles.revenueValue}>₹{data.confirmed_revenue}</Text>
            <View style={styles.revenueMeta}>
              <Text style={styles.revenueMetaText}>Cash ₹{data.cash}</Text>
              <Text style={styles.revenueDot}>•</Text>
              <Text style={styles.revenueMetaText}>UPI ₹{data.upi}</Text>
              {Number(data.pending_amount) > 0 ? <>
                <Text style={styles.revenueDot}>•</Text>
                <Text style={styles.pending}>₹{data.pending_amount} pending</Text>
              </> : null}
            </View>
          </View>

          <View style={styles.metrics}>
            <MetricCard label="Appointments" value={data.appointments} />
            <MetricCard label="Completed" value={data.completed} />
            <MetricCard label="New patients" value={data.new_patients} />
            <MetricCard label="Unique patients" value={data.unique_patients} />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Operations</Text>
            <View style={styles.compactGrid}>
              <CompactMetric label="Cancelled" value={data.cancelled} />
              <CompactMetric label="No-shows" value={data.no_show} />
              <CompactMetric label="Returning" value={data.returning_patient_visits} />
              <CompactMetric label="Follow-ups" value={data.followup_appointments} />
            </View>
          </View>
        </>
      ) : null}
    </AppScreen>
  );
}

function dashboardRange(period: DashboardPeriod, today: string) {
  if (period === 'Today') return { from: today, to: today };
  const days = period === '7Days' ? 7 : 30;
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return { from: date.toISOString().slice(0, 10), to: today };
}

function CompactMetric({ label, value }: { label: string; value: string | number }) {
  return <View style={styles.compactMetric}><Text style={styles.compactValue}>{value}</Text><Text style={styles.compactLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  header: { gap: 3 },
  title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, fontSize: 14 },
  periods: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 4, borderWidth: 1, borderColor: colors.border },
  period: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingHorizontal: 6 },
  periodActive: { backgroundColor: colors.softPrimary },
  periodText: { color: colors.muted, fontWeight: '600', fontSize: 12, textAlign: 'center' },
  periodTextActive: { color: colors.primaryDark, fontWeight: '800' },
  range: { color: colors.muted, fontSize: 12, textAlign: 'right' },
  revenueCard: { backgroundColor: colors.primaryDark, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  revenueLabel: { color: '#CFE0F7', fontSize: 13, fontWeight: '600' },
  revenueValue: { color: colors.surface, fontSize: 34, lineHeight: 40, fontWeight: '800' },
  revenueMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
  revenueMetaText: { color: '#E8F1FB', fontSize: 12, fontWeight: '600' },
  revenueDot: { color: '#7EA2CC', fontSize: 12 },
  pending: { color: '#FFDCA8', fontSize: 12, fontWeight: '700' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.primaryDark },
  compactGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  compactMetric: { flexGrow: 1, flexBasis: '46%', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 3 },
  compactValue: { color: colors.primaryDark, fontSize: 20, fontWeight: '800' },
  compactLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
