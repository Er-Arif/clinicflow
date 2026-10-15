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
import { MetricCard } from '@/components/MetricCard';
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
      <Text style={styles.title}>Reports</Text>
      <Text style={styles.subtitle}>All totals are derived from transactional ClinicFlow records.</Text>

      <QueryState query={clinicTime} label="clinic date" />
      <DateRangeControls today={clinicTime.data?.clinic_date} selection={selection} />

      <QueryState query={appointments} label="appointment report" hasData={Boolean(appointments.currentData)} />
      {appointments.currentData ? (
        <ReportSection title="Appointments">
          <MetricCard label="Total" value={appointments.currentData.total_appointments} />
          <MetricCard label="Completed" value={appointments.currentData.completed} />
          <MetricCard label="Cancelled" value={appointments.currentData.cancelled} />
          <MetricCard label="No-show" value={appointments.currentData.no_show} />
          <MetricCard label="Rescheduled" value={appointments.currentData.rescheduled} />
          <MetricCard label="Still booked" value={appointments.currentData.booked} />
          <View style={styles.chartCard}>
            <Text style={styles.chartHeading}>Status Distribution</Text>
            {appointments.currentData.total_appointments === 0 ? (
              <Text style={styles.emptyChart}>No appointments recorded for this period.</Text>
            ) : (
              <View style={styles.chartList}>
                <ChartBarRow
                  label="Completed"
                  count={appointments.currentData.completed}
                  total={appointments.currentData.total_appointments}
                  color={colors.success}
                />
                <ChartBarRow
                  label="Booked"
                  count={appointments.currentData.booked}
                  total={appointments.currentData.total_appointments}
                  color={colors.primary}
                />
                <ChartBarRow
                  label="Checked In"
                  count={appointments.currentData.checked_in}
                  total={appointments.currentData.total_appointments}
                  color={colors.accent}
                />
                <ChartBarRow
                  label="Cancelled"
                  count={appointments.currentData.cancelled}
                  total={appointments.currentData.total_appointments}
                  color={colors.danger}
                />
                <ChartBarRow
                  label="No-show"
                  count={appointments.currentData.no_show}
                  total={appointments.currentData.total_appointments}
                  color={colors.warning}
                />
                <ChartBarRow
                  label="Rescheduled"
                  count={appointments.currentData.rescheduled}
                  total={appointments.currentData.total_appointments}
                  color={colors.muted}
                />
              </View>
            )}
          </View>
        </ReportSection>
      ) : null}

      <QueryState query={patients} label="patient report" hasData={Boolean(patients.currentData)} />
      {patients.currentData ? (
        <ReportSection title="Patients">
          <MetricCard label="New patients" value={patients.currentData.new_patients} hint="First completed visit in period" />
          <MetricCard label="Returning visits" value={patients.currentData.returning_patient_visits} hint="Completed visits after first visit" />
          <MetricCard label="Unique patients" value={patients.currentData.unique_patients} />
        </ReportSection>
      ) : null}

      <QueryState query={followups} label="follow-up report" hasData={Boolean(followups.currentData)} />
      {followups.currentData ? (
        <ReportSection title="Follow-ups">
          <MetricCard label="Created" value={followups.currentData.created} />
          <MetricCard label="Booked actions" value={followups.currentData.booked_events} />
          <MetricCard label="Closed actions" value={followups.currentData.closed_events} />
          <MetricCard label="Open now" value={followups.currentData.open_current} />
          <MetricCard label="Overdue now" value={followups.currentData.overdue_current} />
        </ReportSection>
      ) : null}

      <QueryState query={payments} label="payment report" hasData={Boolean(payments.currentData)} />
      {payments.currentData ? (
        <ReportSection title="Payments">
          <MetricCard label="Confirmed" value={`₹${payments.currentData.confirmed_total}`} />
          <MetricCard label="Cash" value={`₹${payments.currentData.cash}`} />
          <MetricCard label="UPI" value={`₹${payments.currentData.upi}`} />
          <MetricCard label="Pending" value={`₹${payments.currentData.pending}`} />
          <MetricCard label="Transactions" value={payments.currentData.confirmed_transaction_count} />
          <MetricCard label="Voided" value={payments.currentData.voided_payment_count} />
        </ReportSection>
      ) : null}

    </AppScreen>
  );
}


function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.metrics}>{children}</View>
    </View>
  );
}

function ChartBarRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <View style={styles.barItem}>
      <View style={styles.barLabelRow}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={styles.barValue}>{count} ({pct}%)</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
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
  rangeText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  section: { gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { fontSize: 19, fontWeight: '900', color: colors.text },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chartCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  chartHeading: { fontSize: 15, fontWeight: '800', color: colors.text },
  emptyChart: { color: colors.muted, fontSize: 14, fontStyle: 'italic' },
  chartList: { gap: spacing.sm },
  barItem: { gap: 4 },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  barValue: { fontSize: 13, fontWeight: '700', color: colors.muted },
  barTrack: { height: 8, backgroundColor: colors.background, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
});

