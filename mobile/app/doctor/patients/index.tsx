import { QueryState } from '@/components/QueryState';
import { formatClinicDate } from '@/utils/dates';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

  const normalizedQuery = query.trim();
  const isPatientNumberQuery = /^\d+$/.test(normalizedQuery);
  const shouldSearch = isPatientNumberQuery || normalizedQuery.length >= 2;
  const patients = useSearchPatientsQuery({ q: normalizedQuery }, { skip: !shouldSearch });

  return (
    <KeyboardSafeFormScreen>
      <Text style={styles.title}>Patients</Text>
      <Text style={styles.subtitle}>Search operational patient history.</Text>
      <View style={styles.searchField}>
        <KeyboardSafeTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Mobile, patient name or patient number"
          style={[styles.input, query.length > 0 && styles.searchWithClear]}
          autoCapitalize="words"
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
            onPress={() => setQuery('')}
            style={styles.clearSearch}
          >
            <Text style={styles.clearSearchText}>×</Text>
          </Pressable>
        ) : null}
      </View>
      {!shouldSearch ? <Text style={styles.subtitle}>Enter a patient number or at least 2 characters to search.</Text> :
        <QueryState query={patients} label="patients" hasData={Boolean(patients.currentData)} empty={patients.currentData?.items.length === 0 ? 'No patients match this search.' : undefined} />}
      {shouldSearch ? patients.currentData?.items.map((patient) => (
        <Pressable key={patient.patient_id} style={styles.card} onPress={() => router.push(`/doctor/patients/${patient.patient_id}`)}>
          <Text style={styles.name}>{patient.full_name}</Text>
          <Text style={styles.subtitle}>{patient.patient_code} · {patient.mobile_number || 'No mobile number'}</Text>
          <Text style={styles.meta}>{formatVisitSummary(patient.previous_completed_visits, patient.last_visit_date)}</Text>
        </Pressable>
      )) : null}
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  searchField: { position: 'relative' },
  input: { minHeight: 48, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14 },
  searchWithClear: { paddingRight: 50 },
  clearSearch: { position: 'absolute', right: 8, top: 0, bottom: 0, width: 38, alignItems: 'center', justifyContent: 'center' },
  clearSearchText: { color: colors.muted, fontSize: 24, lineHeight: 26, fontWeight: '500' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  name: { color: colors.text, fontWeight: '900', fontSize: 17 },
  meta: { color: colors.muted, fontSize: 13 },
});
