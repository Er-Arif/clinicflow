import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useClinicTimeQuery, useGetOwnerDashboardQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { MetricCard } from '@/components/MetricCard';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate, isIsoDate, startOfIsoMonth, startOfIsoWeek } from '@/utils/dates';

export default function OwnerDashboardScreen() {
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

  const validRange = isIsoDate(from) && isIsoDate(to);
  const dashboard = useGetOwnerDashboardQuery({ from, to }, { skip: !validRange });
  const today = clinicTime.data?.clinic_date;

  const applyRange = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
  };

  return (
    <AppScreen refreshing={dashboard.isFetching} onRefresh={() => void dashboard.refetch()}>
      <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      <Text style={styles.title}>Owner Dashboard</Text>
      <Text style={styles.subtitle}>Clinic activity and confirmed financial totals.</Text>

      {today ? (
        <View style={styles.chips}>
          <Chip label="Today" onPress={() => applyRange(today, today)} />
          <Chip label="Week" onPress={() => applyRange(startOfIsoWeek(today), today)} />
          <Chip label="Month" onPress={() => applyRange(startOfIsoMonth(today), today)} />
        </View>
      ) : null}

      <View style={styles.dateRow}>
        <TextInput value={from} onChangeText={setFrom} style={styles.input} placeholder="From YYYY-MM-DD" />
        <TextInput value={to} onChangeText={setTo} style={styles.input} placeholder="To YYYY-MM-DD" />
      </View>
      {validRange ? <Text style={styles.subtitle}>{formatClinicDate(from)} → {formatClinicDate(to)}</Text> : null}

      {dashboard.isLoading ? <ActivityIndicator /> : null}
      {dashboard.isError ? <Text style={styles.error}>Unable to load dashboard for this range.</Text> : null}

      {dashboard.data ? (
        <>
          <Text style={styles.sectionTitle}>Operations</Text>
          <View style={styles.metrics}>
            <MetricCard label="Appointments" value={dashboard.data.appointments} />
            <MetricCard label="Completed" value={dashboard.data.completed} />
            <MetricCard label="Cancelled" value={dashboard.data.cancelled} />
            <MetricCard label="No-shows" value={dashboard.data.no_show} />
            <MetricCard label="New patients" value={dashboard.data.new_patients} />
            <MetricCard label="Returning visits" value={dashboard.data.returning_patient_visits} />
            <MetricCard label="Follow-up appts" value={dashboard.data.followup_appointments} />
            <MetricCard label="Unique patients" value={dashboard.data.unique_patients} />
          </View>

          <Text style={styles.sectionTitle}>Financial</Text>
          <View style={styles.metrics}>
            <MetricCard label="Confirmed Revenue" value={`₹${dashboard.data.confirmed_revenue}`} />
            <MetricCard label="Cash" value={`₹${dashboard.data.cash}`} />
            <MetricCard label="UPI" value={`₹${dashboard.data.upi}`} />
            <MetricCard label="Pending" value={`₹${dashboard.data.pending_amount}`} />
          </View>
        </>
      ) : null}

      <AppButton label="Open Reports" onPress={() => router.push('/(doctor)/reports')} />
      <AppButton label="Patient Search" tone="secondary" onPress={() => router.push('/(doctor)/patients')} />
    </AppScreen>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.chip}><Text style={styles.chipText}>{label}</Text></Pressable>;
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
  sectionTitle: { fontSize: 18, fontWeight: '900', color: colors.text, marginTop: spacing.sm },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
