import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  useClinicTimeQuery,
  useGetAppointmentReportQuery,
  useGetFollowUpReportQuery,
  useGetPatientReportQuery,
  useGetPaymentReportQuery,
} from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { DateRangeControls, useReportRange } from '@/components/DateRangeControls';
import { QueryState } from '@/components/QueryState';
import { colors, radius, spacing } from '@/theme/tokens';

export default function ReportsScreen() {
  const clinicTime = useClinicTimeQuery();
  const selection = useReportRange(clinicTime.data?.clinic_date);
  const args = selection.range;
  const skip = Boolean(selection.error);
  const appointments = useGetAppointmentReportQuery(args, { skip });
  const patients = useGetPatientReportQuery(args, { skip });
  const followups = useGetFollowUpReportQuery(args, { skip });
  const payments = useGetPaymentReportQuery(args, { skip });
  const refreshing = appointments.isFetching || patients.isFetching || followups.isFetching || payments.isFetching;
  const refreshAll = () => {
    if (skip) { void clinicTime.refetch(); return; }
    for (const query of [appointments, patients, followups, payments]) void query.refetch();
  };

  return (
    <AppScreen refreshing={refreshing} onRefresh={refreshAll}>
      <View style={styles.header}>
        <Text style={styles.title}>Reports</Text>
        <Text style={styles.subtitle}>Clinic performance and financial activity</Text>
      </View>

      <QueryState query={clinicTime} label="clinic date" />
      <View style={styles.filterCard}>
        <Text style={styles.filterTitle}>Period</Text>
        <DateRangeControls today={clinicTime.data?.clinic_date} selection={selection} />
      </View>

      <QueryState query={appointments} label="appointment report" hasData={Boolean(appointments.currentData)} />
      {appointments.currentData ? (
        <ReportSection title="Appointments">
          <StatGrid items={[
            ['Total', appointments.currentData.total_appointments],
            ['Completed', appointments.currentData.completed],
            ['Cancelled', appointments.currentData.cancelled],
            ['No-show', appointments.currentData.no_show],
            ['Rescheduled', appointments.currentData.rescheduled],
            ['Still booked', appointments.currentData.booked],
          ]} />
          {appointments.currentData.total_appointments > 0 ? (
            <View style={styles.chartBlock}>
              <Text style={styles.chartHeading}>Status distribution</Text>
              <ChartBarRow label="Completed" count={appointments.currentData.completed} total={appointments.currentData.total_appointments} color={colors.success} />
              <ChartBarRow label="Booked" count={appointments.currentData.booked} total={appointments.currentData.total_appointments} color={colors.primary} />
              <ChartBarRow label="Checked in" count={appointments.currentData.checked_in} total={appointments.currentData.total_appointments} color={colors.accent} />
              <ChartBarRow label="Cancelled" count={appointments.currentData.cancelled} total={appointments.currentData.total_appointments} color={colors.danger} />
              <ChartBarRow label="No-show" count={appointments.currentData.no_show} total={appointments.currentData.total_appointments} color={colors.warning} />
              <ChartBarRow label="Rescheduled" count={appointments.currentData.rescheduled} total={appointments.currentData.total_appointments} color={colors.muted} />
            </View>
          ) : <Text style={styles.empty}>No appointments recorded in this period.</Text>}
        </ReportSection>
      ) : null}

      <QueryState query={patients} label="patient report" hasData={Boolean(patients.currentData)} />
      {patients.currentData ? (
        <ReportSection title="Patients">
          <StatGrid items={[
            ['New patients', patients.currentData.new_patients],
            ['Returning visits', patients.currentData.returning_patient_visits],
            ['Unique patients', patients.currentData.unique_patients],
          ]} />
        </ReportSection>
      ) : null}

      <QueryState query={followups} label="follow-up report" hasData={Boolean(followups.currentData)} />
      {followups.currentData ? (
        <ReportSection title="Follow-ups">
          <StatGrid items={[
            ['Created', followups.currentData.created],
            ['Booked', followups.currentData.booked_events],
            ['Closed', followups.currentData.closed_events],
            ['Open now', followups.currentData.open_current],
            ['Overdue', followups.currentData.overdue_current],
          ]} />
        </ReportSection>
      ) : null}

      <QueryState query={payments} label="payment report" hasData={Boolean(payments.currentData)} />
      {payments.currentData ? (
        <ReportSection title="Payments">
          <StatGrid items={[
            ['Confirmed', `₹${payments.currentData.confirmed_total}`],
            ['Cash', `₹${payments.currentData.cash}`],
            ['UPI', `₹${payments.currentData.upi}`],
            ['Pending', `₹${payments.currentData.pending}`],
            ['Transactions', payments.currentData.confirmed_transaction_count],
            ['Voided', payments.currentData.voided_payment_count],
          ]} />
        </ReportSection>
      ) : null}
    </AppScreen>
  );
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.sectionCard}>{children}</View></View>;
}

function StatGrid({ items }: { items: [string, string | number][] }) {
  return <View style={styles.stats}>{items.map(([label, value]) => <View key={label} style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>)}</View>;
}

function ChartBarRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <View style={styles.barItem}>
      <View style={styles.barLabelRow}><Text style={styles.barLabel}>{label}</Text><Text style={styles.barValue}>{count} · {pct}%</Text></View>
      <View style={styles.barTrack}><View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  title: { fontSize: 25, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, fontSize: 13 },
  filterCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 13, gap: spacing.sm },
  filterTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 14 },
  section: { gap: spacing.xs, marginTop: 2 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.primaryDark },
  sectionCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 13, gap: spacing.md },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  stat: { flexBasis: '50%', minWidth: 0, paddingRight: 8, gap: 2 },
  statValue: { color: colors.primaryDark, fontSize: 19, lineHeight: 23, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  chartBlock: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.sm },
  chartHeading: { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
  empty: { color: colors.muted, fontSize: 13 },
  barItem: { gap: 5 },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel: { fontSize: 12, fontWeight: '600', color: colors.text },
  barValue: { fontSize: 11, fontWeight: '700', color: colors.muted },
  barTrack: { height: 6, backgroundColor: colors.surfaceSoft, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
});
