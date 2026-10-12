import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useGetPatientOperationalSummaryQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate } from '@/utils/dates';

export default function DoctorPatientSummaryScreen() {
  const params = useLocalSearchParams<{ patientId: string }>();
  const patientId = String(params.patientId ?? '');
  const summary = useGetPatientOperationalSummaryQuery(patientId, { skip: !patientId });
  const data = summary.data;

  if (summary.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!data) {
    return (
      <AppScreen>
        <BackButton />
        <Text style={styles.title}>Unable to load patient</Text>
        <AppButton label="Retry" onPress={() => void summary.refetch()} />
      </AppScreen>
    );
  }

  return (
    <AppScreen refreshing={summary.isFetching} onRefresh={() => void summary.refetch()}>
      <BackButton />
      <Text style={styles.title}>{data.patient.full_name}</Text>
      <Text style={styles.subtitle}>{data.patient.patient_code} · Age {data.patient.age ?? '—'} · {data.patient.gender.replaceAll('_', ' ')}</Text>
      <Text style={styles.subtitle}>{formatPhone(data.patient.mobile_number)}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Visit Summary</Text>
        <Row label="Completed visits" value={String(data.total_completed_visits)} />
        <Row label="Last visit" value={data.last_visit_date ? formatClinicDate(data.last_visit_date) : 'No completed visit'} />
      </View>

      {data.upcoming_appointment ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Upcoming Appointment</Text>
          <Row label="Date" value={formatClinicDate(data.upcoming_appointment.date)} />
          <Row label="Time" value={data.upcoming_appointment.appointment_time?.slice(0, 5) ?? 'Walk-in'} />
          <Row label="Type" value={labelType(data.upcoming_appointment.appointment_type)} />
        </View>
      ) : null}

      {data.open_followup ? (
        <View style={[styles.card, data.open_followup.overdue && styles.warningCard]}>
          <Text style={styles.cardTitle}>{data.open_followup.overdue ? 'Overdue Follow-up' : 'Open Follow-up'}</Text>
          <Row label="Due" value={formatClinicDate(data.open_followup.due_date)} />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Visit History</Text>
        {data.visit_history.map((visit) => (
          <View key={visit.visit_id} style={styles.visitCard}>
            <View style={styles.rowTop}>
              <Text style={styles.visitDate}>{formatClinicDate(visit.date)}</Text>
              <Text style={styles.type}>{labelType(visit.appointment_type)}</Text>
            </View>
            <Text style={styles.subtitle}>Payment {visit.payment_status ?? '—'} · Follow-up {visit.followup_status ?? 'None'}</Text>
          </View>
        ))}
        {data.visit_history.length === 0 ? <Text style={styles.subtitle}>No completed visit history.</Text> : null}
      </View>
    </AppScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

function labelType(value: string) {
  return value === 'FOLLOW_UP' ? 'Follow-up' : 'Regular Consultation';
}

function formatPhone(value: string) {
  const digits = value.replace('+91', '');
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : value;
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  warningCard: { borderColor: colors.warning },
  cardTitle: { fontSize: 17, fontWeight: '900', color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted },
  value: { color: colors.text, fontWeight: '700', textAlign: 'right', flex: 1 },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: colors.text },
  visitCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 5 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  visitDate: { color: colors.text, fontWeight: '900' },
  type: { color: colors.primary, fontWeight: '800' },
});
