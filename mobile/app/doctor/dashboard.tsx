import { StyleSheet, Text, View } from 'react-native';

import { useClinicTimeQuery, useGetOwnerDashboardQuery } from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { DateRangeControls, useReportRange } from '@/components/DateRangeControls';
import { QueryState } from '@/components/QueryState';
import { MetricCard } from '@/components/MetricCard';
import { colors, spacing } from '@/theme/tokens';

export default function OwnerDashboardScreen() {
  const clinicTime = useClinicTimeQuery();
  const selection = useReportRange(clinicTime.data?.clinic_date);
  const validRange = !selection.error;
  const dashboard = useGetOwnerDashboardQuery(selection.range, { skip: !validRange });
  const data = dashboard.currentData;
  const refresh = () => { if (validRange) void dashboard.refetch(); else void clinicTime.refetch(); };

  return (
    <AppScreen refreshing={dashboard.isFetching} onRefresh={refresh}>
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.subtitle}>Clinic activity and confirmed financial totals.</Text>

      <QueryState query={clinicTime} label="clinic date" />
      <DateRangeControls today={clinicTime.data?.clinic_date} selection={selection} />
      <QueryState query={dashboard} label="dashboard" hasData={Boolean(data)} />

      {data ? (
        <>
          <Text style={styles.sectionTitle}>Operations</Text>
          <View style={styles.metrics}>
            <MetricCard label="Appointments" value={data.appointments} />
            <MetricCard label="Completed" value={data.completed} />
            <MetricCard label="Cancelled" value={data.cancelled} />
            <MetricCard label="No-shows" value={data.no_show} />
            <MetricCard label="New patients" value={data.new_patients} />
            <MetricCard label="Returning visits" value={data.returning_patient_visits} />
            <MetricCard label="Follow-up appts" value={data.followup_appointments} />
            <MetricCard label="Unique patients" value={data.unique_patients} />
          </View>

          <Text style={styles.sectionTitle}>Financial</Text>
          <View style={styles.metrics}>
            <MetricCard label="Confirmed Revenue" value={`₹${data.confirmed_revenue}`} />
            <MetricCard label="Cash" value={`₹${data.cash}`} />
            <MetricCard label="UPI" value={`₹${data.upi}`} />
            <MetricCard label="Pending" value={`₹${data.pending_amount}`} />
          </View>
        </>
      ) : null}
    </AppScreen>
  );
}


const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' },
  title: { fontSize: 24, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger, fontWeight: '700' },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: { backgroundColor: colors.softPrimary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { color: colors.primary, fontWeight: '800' },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: colors.text, marginTop: spacing.sm },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

