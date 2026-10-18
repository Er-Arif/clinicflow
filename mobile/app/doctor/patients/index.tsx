import { QueryState } from '@/components/QueryState';
import { formatClinicDate } from '@/utils/dates';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, } from 'react-native';

import { useSearchPatientsQuery } from '@/api/api';
import { colors, radius, spacing } from '@/theme/tokens';

function formatVisitSummary(completedVisits: number, lastVisitDate?: string | null) {
  if (completedVisits === 0) return 'No completed visits yet';
  const visits = `${completedVisits} completed ${completedVisits === 1 ? 'visit' : 'visits'}`;
  return `${visits} · Last visit ${lastVisitDate ? formatClinicDate(lastVisitDate) : 'unavailable'}`;
}

export default function DoctorPatientSearchScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const unsub = navigation.getParent()?.addListener('blur', () => {
      setQuery('');
    });
    return unsub;
  }, [navigation]);

  const patients = useSearchPatientsQuery({ q: query.trim() }, { skip: query.trim().length < 2 });

  return (
    <KeyboardSafeFormScreen>
      <Text style={styles.title}>Patients</Text>
      <Text style={styles.subtitle}>Search operational patient history.</Text>
      <KeyboardSafeTextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Mobile, patient name or patient ID"
        style={styles.input}
        autoCapitalize="words"
      />
      {query.trim().length < 2 ? <Text style={styles.subtitle}>Enter at least 2 characters to search.</Text> :
        <QueryState query={patients} label="patients" hasData={Boolean(patients.currentData)} empty={patients.currentData?.items.length === 0 ? 'No patients match this search.' : undefined} />}
      {patients.currentData?.items.map((patient) => (
        <Pressable key={patient.patient_id} style={styles.card} onPress={() => router.push(`/doctor/patients/${patient.patient_id}`)}>
          <Text style={styles.name}>{patient.full_name}</Text>
          <Text style={styles.subtitle}>{patient.patient_code} · {patient.mobile_number}</Text>
          <Text style={styles.meta}>{formatVisitSummary(patient.previous_completed_visits, patient.last_visit_date)}</Text>
        </Pressable>
      ))}
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  input: { minHeight: 48, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  name: { color: colors.text, fontWeight: '900', fontSize: 17 },
  meta: { color: colors.muted, fontSize: 13 },
});
