import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { useSearchPatientsQuery } from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

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
    <AppScreen>
      <Text style={styles.title}>Patients</Text>
      <Text style={styles.subtitle}>Search operational patient history.</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Mobile, patient name or patient ID"
        style={styles.input}
        autoCapitalize="words"
      />
      {patients.isFetching ? <ActivityIndicator /> : null}
      {patients.data?.items.map((patient) => (
        <Pressable key={patient.patient_id} style={styles.card} onPress={() => router.push(`/doctor/patients/${patient.patient_id}`)}>
          <Text style={styles.name}>{patient.full_name}</Text>
          <Text style={styles.subtitle}>{patient.patient_code} · {patient.mobile_number}</Text>
          <Text style={styles.meta}>{patient.previous_completed_visits} completed visit(s) · Last {patient.last_visit_date ?? '—'}</Text>
        </Pressable>
      ))}
      {query.trim().length >= 2 && !patients.isFetching && patients.data?.items.length === 0 ? <Text style={styles.subtitle}>No patient found.</Text> : null}
    </AppScreen>
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

