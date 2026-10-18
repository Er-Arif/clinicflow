import { QueryState } from '@/components/QueryState';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useGetPatientOperationalSummaryQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate, formatClinicTime } from '@/utils/dates';

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
      <QueryState query={summary} label="patient history" />
      <Text style={styles.title}>{data.patient.full_name}</Text>
      <Text style={styles.subtitle}>
        {data.patient.patient_code} · {data.patient.age != null ? `${data.patient.age} years` : 'Age not recorded'} · {humanize(data.patient.gender)}
      </Text>
      <Text style={styles.subtitle}>{data.patient.mobile_number ? formatPhone(data.patient.mobile_number) : 'No mobile number'}</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Visit summary</Text>
        <Row label="Completed visits" value={String(data.total_completed_visits)} />
        <Row label="Last visit" value={data.last_visit_date ? formatClinicDate(data.last_visit_date) : 'No completed visits yet'} />
      </View>

      {data.upcoming_appointment ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Upcoming appointment</Text>
          <Row label="Date" value={formatClinicDate(data.upcoming_appointment.date)} />
          <Row label="Time" value={data.upcoming_appointment.appointment_time ? formatClinicTime(data.upcoming_appointment.appointment_time) : 'Walk-in'} />
          <Row label="Type" value={labelType(data.upcoming_appointment.appointment_type)} />
        </View>
      ) : null}

      {data.open_followup ? (
        <View style={[styles.card, data.open_followup.overdue && styles.warningCard]}>
          <Text style={styles.cardTitle}>{data.open_followup.overdue ? 'Overdue follow-up' : 'Open follow-up'}</Text>
          <Row label="Due" value={formatClinicDate(data.open_followup.due_date)} />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent completed visits</Text>
        <Text style={styles.subtitle}>
          {data.total_completed_visits === 0
            ? 'No completed visit history yet.'
            : `Showing ${data.visit_history.length} of ${data.total_completed_visits} completed ${data.total_completed_visits === 1 ? 'visit' : 'visits'}.`}
        </Text>
        {data.visit_history.map((visit) => (
          <View key={visit.visit_id} style={styles.visitCard}>
            <View style={styles.rowTop}>
              <Text style={styles.visitDate}>{formatClinicDate(visit.date)}</Text>
              <Text style={styles.type}>{labelType(visit.appointment_type)}</Text>
            </View>
            <Text style={styles.subtitle}>
              {`Payment ${humanize(visit.payment_status ?? 'Not recorded')} · ${visit.followup_status && visit.followup_status !== 'NONE' ? `Follow-up ${humanize(visit.followup_status)}` : 'No follow-up'}`}
            </Text>
          </View>
        ))}
      </View>
    </AppScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

function labelType(value: string) {
  return value === 'FOLLOW_UP' ? 'Follow-up' : 'Regular consultation';
}

function humanize(value: string) {
  const normalized = value.replaceAll('_', ' ').trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '—';
}

function formatPhone(value: string) {
  const compact = value.replace(/\s/g, '');
  if (/^\+91\d{10}$/.test(compact)) {
    const digits = compact.slice(3);
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (/^\d{10}$/.test(compact)) return `${compact.slice(0, 5)} ${compact.slice(5)}`;
  return value;
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
