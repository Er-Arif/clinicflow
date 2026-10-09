import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { useSearchPatientsQuery } from '@/api/api';
import { colors, radius, spacing } from '@/theme/tokens';

export default function PatientSearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim();
  const shouldSearch = normalizedQuery.length >= 2;
  const { data, isFetching, isError, refetch } = useSearchPatientsQuery(
    { q: normalizedQuery },
    { skip: !shouldSearch },
  );

  const mobilePrefill = useMemo(() => query.replace(/\D/g, ''), [query]);

  return (
    <AppScreen>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Patients</Text>
          <Text style={styles.subtitle}>Search before creating a new patient.</Text>
        </View>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      </View>

      <TextInput
        autoFocus
        placeholder="Mobile, patient name or patient ID"
        value={query}
        onChangeText={setQuery}
        style={styles.search}
        autoCapitalize="words"
      />

      {!shouldSearch ? (
        <Text style={styles.helper}>Enter at least 2 characters to search.</Text>
      ) : isFetching ? (
        <ActivityIndicator />
      ) : isError ? (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Unable to load patients</Text>
          <AppButton label="Retry" tone="secondary" onPress={() => void refetch()} />
        </View>
      ) : data?.items.length ? (
        <View style={styles.list}>
          {data.items.map((patient) => (
            <Pressable
              key={patient.patient_id}
              style={styles.card}
              onPress={() => router.push(`/assistant/patients/${patient.patient_id}`)}
            >
              <Text style={styles.patientName}>{patient.full_name}</Text>
              <Text style={styles.meta}>{patient.patient_code} · Age {patient.age} · {patient.gender.replaceAll('_', ' ')}</Text>
              <Text style={styles.meta}>{formatPhone(patient.mobile_number)}</Text>
              <Text style={styles.meta}>
                {patient.previous_completed_visits > 0
                  ? `${patient.previous_completed_visits} completed visit${patient.previous_completed_visits === 1 ? '' : 's'}`
                  : 'No completed visits yet'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>No patient found</Text>
          <Text style={styles.helper}>Register a new patient if this person is not already in ClinicFlow.</Text>
        </View>
      )}

      <AppButton
        label="Register New Patient"
        onPress={() =>
          router.push({ pathname: '/assistant/patients/new', params: { mobile: mobilePrefill } })
        }
      />
    </AppScreen>
  );
}

function formatPhone(value: string) {
  const digits = value.replace('+91', '');
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : value;
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, marginTop: 4 },
  link: { color: colors.primary, fontWeight: '700', paddingTop: 6 },
  search: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  helper: { color: colors.muted, lineHeight: 20 },
  list: { gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  patientName: { fontSize: 18, fontWeight: '700', color: colors.text },
  meta: { color: colors.muted },
  stateCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stateTitle: { fontWeight: '700', fontSize: 17, color: colors.text },
});

