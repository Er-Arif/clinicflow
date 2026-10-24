import { formatClinicDate } from '@/utils/dates';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useGetPatientQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

export default function PatientProfileScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ patientId: string }>();
  const patientId = String(params.patientId ?? '');
  const { data: patient, isLoading, isError, refetch } = useGetPatientQuery(patientId, {
    skip: !patientId,
  });

  if (isLoading) {
    return <AppScreen><ActivityIndicator /></AppScreen>;
  }
  if (isError || !patient) {
    return (
      <AppScreen>
        <BackButton />
        <Text style={styles.title}>Unable to load patient</Text>
        <AppButton label="Retry" onPress={() => void refetch()} />
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <BackButton />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{patient.full_name}</Text>
          <Text style={styles.subtitle}>{patient.patient_code} · Age {patient.age}</Text>
        </View>
        <AppButton
          label="Edit"
          tone="secondary"
          onPress={() =>
            router.push({ pathname: '/assistant/patients/edit', params: { patientId } })
          }
        />
      </View>

      <InfoCard title="Contact">
        <InfoRow label="Mobile" value={patient.mobile_number ? formatPhone(patient.mobile_number) : 'Not provided'} />
        <InfoRow label="WhatsApp" value={patient.whatsapp_number ? formatPhone(patient.whatsapp_number) : 'Not provided'} />
        <InfoRow label="Language" value={patient.preferred_language === 'HI' ? 'Hindi' : 'English'} />
        <InfoRow label="Reminders" value={patient.reminders_enabled ? 'Enabled' : 'Disabled'} />
      </InfoCard>

      <InfoCard title="Patient details">
        <InfoRow label="Gender" value={humanize(patient.gender)} />
        <InfoRow
          label="Age source"
          value={patient.date_of_birth ? `DOB ${formatClinicDate(patient.date_of_birth)}` : `Approx. age ${patient.approximate_age_years}`}
        />
      </InfoCard>

      <InfoCard title="Visit summary">
        <InfoRow label="Completed visits" value={String(patient.previous_completed_visits)} />
        <InfoRow label="Last visit" value={patient.last_visit_date ? formatClinicDate(patient.last_visit_date) : 'No completed visit yet'} />
      </InfoCard>

      <View style={styles.actions}>
        <AppButton label="Book appointment" onPress={() => router.push({ pathname: '/assistant/appointments/new', params: { patientId } })} />
        <AppButton label="Add walk-in" tone="secondary" onPress={() => router.push({ pathname: '/assistant/walk-in', params: { patientId } })} />
      </View>
    </AppScreen>
  );
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function humanize(value: string) {
  const normalized = value.replaceAll('_', ' ').trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Not provided';
}

function formatPhone(value: string) {
  const digits = value.replace('+91', '');
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : value;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, marginTop: 4 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted },
  value: { color: colors.text, fontWeight: '600', textAlign: 'right', flex: 1 },
  actions: { gap: spacing.sm },
});
