import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  useClinicTimeQuery,
  useGetAppointmentReportQuery,
  useGetFollowUpReportQuery,
  useGetPatientReportQuery,
  useGetPaymentReportQuery,
} from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { MetricCard } from '@/components/MetricCard';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate, isIsoDate, startOfIsoMonth, startOfIsoWeek } from '@/utils/dates';

export default function ReportsScreen() {
  const router = useRouter();
  const clinicTime = useClinicTimeQuery();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    if (!from && clinicTime.data?.clinic_date) {
      setFrom(clinicTime.data.clinic_date);
      setTo(clinicTime.data.clinic_date);
    }
  }, [clinicTime.data?.clinic_date, from]);

  const args = { from, to };
  const validRange = isIsoDate(from) && isIsoDate(to);
  const skip = !validRange;
  const appointments = useGetAppointmentReportQuery(args, { skip });
  const patients = useGetPatientReportQuery(args, { skip });
  const followups = useGetFollowUpReportQuery(args, { skip });
  const payments = useGetPaymentReportQuery(args, { skip });
  const refreshing = appointments.isFetching || patients.isFetching || followups.isFetching || payments.isFetching;
  const refreshAll = () => {
    void appointments.refetch();
    void patients.refetch();
    void followups.refetch();
    void payments.refetch();
  };
  const today = clinicTime.data?.clinic_date;

  return (
    <AppScreen refreshing={refreshing} onRefresh={refreshAll}>
      <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      <Text style={styles.title}>Reports</Text>
      <Text style={styles.subtitle}>All totals are derived from transactional ClinicFlow records.</Text>

      {today ? (
        <View style={styles.chips}>
          <Chip label="Today" onPress={() => { setFrom(today); setTo(today); }} />
          <Chip label="Week" onPress={() => { setFrom(startOfIsoWeek(today)); setTo(today); }} />
          <Chip label="Month" onPress={() => { setFrom(startOfIsoMonth(today)); setTo(today); }} />
        </View>
      ) : null}

      <View style={styles.dateRow}>
        <TextInput value={from} onChangeText={setFrom} style={styles.input} placeholder="From YYYY-MM-DD" />
        <TextInput value={to} onChangeText={setTo} style={styles.input} placeholder="To YYYY-MM-DD" />
      </View>
      {validRange ? <Text style={styles.subtitle}>{formatClinicDate(from)} → {formatClinicDate(to)}</Text> : null}
      {refreshing && !appointments.data ? <ActivityIndicator /> : null}

      {appointments.data ? (
        <ReportSection title="Appointments">
          <MetricCard label="Total" value={appointments.data.total_appointments} />
          <MetricCard label="Completed" value={appointments.data.completed} />
          <MetricCard label="Cancelled" value={appointments.data.cancelled} />
          <MetricCard label="No-show" value={appointments.data.no_show} />
          <MetricCard label="Rescheduled" value={appointments.data.rescheduled} />
          <MetricCard label="Still booked" value={appointments.data.booked} />
        </ReportSection>
      ) : null}

      {patients.data ? (
        <ReportSection title="Patients">
          <MetricCard label="New patients" value={patients.data.new_patients} hint="First completed visit in period" />
          <MetricCard label="Returning visits" value={patients.data.returning_patient_visits} hint="Completed visits after first visit" />
          <MetricCard label="Unique patients" value={patients.data.unique_patients} />
        </ReportSection>
      ) : null}

      {followups.data ? (
        <ReportSection title="Follow-ups">
          <MetricCard label="Created" value={followups.data.created} />
          <MetricCard label="Booked actions" value={followups.data.booked_events} />
          <MetricCard label="Closed actions" value={followups.data.closed_events} />
          <MetricCard label="Open now" value={followups.data.open_current} />
          <MetricCard label="Overdue now" value={followups.data.overdue_current} />
        </ReportSection>
      ) : null}

      {payments.data ? (
        <ReportSection title="Payments">
          <MetricCard label="Confirmed" value={`₹${payments.data.confirmed_total}`} />
          <MetricCard label="Cash" value={`₹${payments.data.cash}`} />
          <MetricCard label="UPI" value={`₹${payments.data.upi}`} />
          <MetricCard label="Pending" value={`₹${payments.data.pending}`} />
          <MetricCard label="Transactions" value={payments.data.confirmed_transaction_count} />
          <MetricCard label="Voided" value={payments.data.voided_payment_count} />
        </ReportSection>
      ) : null}

      {appointments.isError || patients.isError || followups.isError || payments.isError ? (
        <Text style={styles.error}>One or more reports could not be loaded for this range.</Text>
      ) : null}
    </AppScreen>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.chip}><Text style={styles.chipText}>{label}</Text></Pressable>;
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.metrics}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger, fontWeight: '700' },
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: { backgroundColor: colors.softPrimary, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { color: colors.primary, fontWeight: '800' },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  input: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12 },
  section: { gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { fontSize: 19, fontWeight: '900', color: colors.text },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
