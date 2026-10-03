import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { apiError } from '@/api/errors';
import { useGetPatientQuery, useUpdatePatientMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { PatientForm } from '@/features/patients/PatientForm';
import { PatientFormValues } from '@/features/patients/form';
import { DuplicateCandidate, Patient, PatientUpdatePayload } from '@/features/patients/types';
import { colors, radius, spacing } from '@/theme/tokens';

export default function EditPatientScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ patientId: string }>();
  const patientId = String(params.patientId ?? '');
  const { data: patient, isLoading, isError } = useGetPatientQuery(patientId, { skip: !patientId });
  const [updatePatient, mutation] = useUpdatePatientMutation();
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[]>([]);
  const [pendingPayload, setPendingPayload] = useState<PatientUpdatePayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const initial = useMemo(() => (patient ? toFormValues(patient) : null), [patient]);

  if (isLoading || !initial) {
    if (isError) return <AppScreen><Text>Unable to load patient.</Text></AppScreen>;
    return <AppScreen><ActivityIndicator /></AppScreen>;
  }

  async function submit(values: PatientFormValues, allowSharedMobile = false) {
    if (!patient) return;
    const payload = toUpdatePayload(values, patient.version, allowSharedMobile);
    try {
      const updated = await updatePatient({ patientId, body: payload }).unwrap();
      router.replace(`/(assistant)/patients/${updated.patient_id}`);
    } catch (error) {
      const parsed = apiError(error);
      if (parsed?.code === 'POTENTIAL_DUPLICATE_PATIENT') {
        setDuplicateCandidates((parsed.details?.candidates ?? []) as DuplicateCandidate[]);
        setPendingPayload(payload);
        return;
      }
      setMessage(parsed?.message ?? 'Unable to update the patient.');
    }
  }

  async function saveSharedNumber() {
    if (!pendingPayload) return;
    try {
      const updated = await updatePatient({
        patientId,
        body: { ...pendingPayload, allow_shared_mobile: true },
      }).unwrap();
      router.replace(`/(assistant)/patients/${updated.patient_id}`);
    } catch (error) {
      setMessage(apiError(error)?.message ?? 'Unable to update the patient.');
    }
  }

  return (
    <AppScreen>
      <Text style={styles.title}>Edit Patient</Text>
      {duplicateCandidates.length ? (
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>This mobile number is already used by another patient.</Text>
          {duplicateCandidates.map((item) => (
            <Text key={item.patient_id} style={styles.meta}>{item.full_name} · {item.patient_code} · Age {item.age}</Text>
          ))}
          <AppButton
            label="Save Anyway (Shared Number)"
            onPress={() => void saveSharedNumber()}
            loading={mutation.isLoading}
          />
        </View>
      ) : null}
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <PatientForm
        initialValues={initial}
        submitLabel="Save Changes"
        loading={mutation.isLoading}
        onSubmit={(values) => void submit(values)}
      />
    </AppScreen>
  );
}

function toFormValues(patient: Patient): PatientFormValues {
  return {
    fullName: patient.full_name,
    mobile: patient.mobile_number,
    whatsappSame: patient.whatsapp_same_as_mobile,
    whatsapp: patient.whatsapp_same_as_mobile ? '' : patient.whatsapp_number,
    ageMode: patient.date_of_birth ? 'DOB' : 'AGE',
    dateOfBirth: patient.date_of_birth ?? '',
    approximateAge: patient.approximate_age_years?.toString() ?? '',
    gender: patient.gender,
    language: patient.preferred_language,
    remindersEnabled: patient.reminders_enabled,
  };
}

function toUpdatePayload(
  values: PatientFormValues,
  version: number,
  allowSharedMobile: boolean,
): PatientUpdatePayload {
  return {
    expected_version: version,
    full_name: values.fullName.trim(),
    mobile_number: values.mobile.trim(),
    whatsapp_same_as_mobile: values.whatsappSame,
    whatsapp_number: values.whatsappSame ? undefined : values.whatsapp.trim(),
    date_of_birth: values.ageMode === 'DOB' ? values.dateOfBirth : null,
    approximate_age_years: values.ageMode === 'AGE' ? Number(values.approximateAge) : null,
    gender: values.gender,
    preferred_language: values.language,
    reminders_enabled: values.remindersEnabled,
    allow_shared_mobile: allowSharedMobile,
  };
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  error: { color: colors.danger },
  warning: {
    borderWidth: 1,
    borderColor: '#F0B429',
    backgroundColor: '#FFF8E6',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  warningTitle: { color: colors.warning, fontWeight: '800' },
  meta: { color: colors.muted },
});
