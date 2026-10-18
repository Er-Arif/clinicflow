import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { apiError } from '@/api/errors';
import { useCreatePatientMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { PatientForm } from '@/features/patients/PatientForm';
import { PatientFormValues, patientFormDefaults } from '@/features/patients/form';
import { DuplicateCandidate, PatientCreatePayload } from '@/features/patients/types';
import { colors, radius, spacing } from '@/theme/tokens';

export default function NewPatientScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mobile?: string }>();
  const [createPatient, mutation] = useCreatePatientMutation();
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateCandidate[]>([]);
  const [pendingPayload, setPendingPayload] = useState<PatientCreatePayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const initial = {
    ...patientFormDefaults,
    mobile: typeof params.mobile === 'string' ? params.mobile : '',
  };

  async function submit(values: PatientFormValues, allowSharedMobile = false) {
    const payload = toPayload(values, allowSharedMobile);
    setMessage(null);
    try {
      const patient = await createPatient(payload).unwrap();
      router.replace(`/assistant/patients/${patient.patient_id}`);
    } catch (error) {
      const parsed = apiError(error);
      if (parsed?.code === 'POTENTIAL_DUPLICATE_PATIENT') {
        const candidates = (parsed.details?.candidates ?? []) as DuplicateCandidate[];
        setDuplicateCandidates(candidates);
        setPendingPayload(payload);
        return;
      }
      setMessage(parsed?.message ?? 'Unable to save the patient. Check your connection and try again.');
    }
  }

  async function registerSharedNumber() {
    if (!pendingPayload) return;
    setMessage(null);
    try {
      const patient = await createPatient({ ...pendingPayload, allow_shared_mobile: true }).unwrap();
      router.replace(`/assistant/patients/${patient.patient_id}`);
    } catch (error) {
      setMessage(apiError(error)?.message ?? 'Unable to save the patient.');
    }
  }

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <Text style={styles.title}>New patient</Text>
      <Text style={styles.subtitle}>Enter only the administrative information ClinicFlow needs.</Text>

      {duplicateCandidates.length ? (
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>A patient with this mobile number already exists.</Text>
          {duplicateCandidates.map((candidate) => (
            <View key={candidate.patient_id} style={styles.candidate}>
              <Text style={styles.candidateName}>{candidate.full_name}</Text>
              <Text style={styles.meta}>{candidate.patient_code} · Age {candidate.age}</Text>
              <AppButton
                label="Open existing patient"
                tone="secondary"
                onPress={() => router.replace(`/assistant/patients/${candidate.patient_id}`)}
              />
            </View>
          ))}
          <Text style={styles.meta}>
            If this is another family member or patient who legitimately shares the number, continue explicitly.
          </Text>
          <AppButton
            label="Register another patient with this number"
            onPress={() => void registerSharedNumber()}
            loading={mutation.isLoading}
          />
        </View>
      ) : null}

      {message ? <Text style={styles.error}>{message}</Text> : null}
      <PatientForm
        initialValues={initial}
        submitLabel="Save patient"
        loading={mutation.isLoading}
        onSubmit={(values) => void submit(values)}
      />
    </KeyboardSafeFormScreen>
  );
}

function toPayload(values: PatientFormValues, allowSharedMobile: boolean): PatientCreatePayload {
  const mobile = values.mobile.trim();
  const whatsapp = values.whatsapp.trim();
  const hasMobile = mobile.length > 0;
  const whatsappSameAsMobile = hasMobile && values.whatsappSame;
  const messageContactAvailable = whatsappSameAsMobile || whatsapp.length >= 10;

  return {
    full_name: values.fullName.trim(),
    mobile_number: hasMobile ? mobile : null,
    whatsapp_same_as_mobile: whatsappSameAsMobile,
    whatsapp_number: whatsappSameAsMobile ? undefined : whatsapp || undefined,
    date_of_birth: values.ageMode === 'DOB' ? values.dateOfBirth : undefined,
    approximate_age_years: values.ageMode === 'AGE' ? Number(values.approximateAge) : undefined,
    gender: values.gender as PatientCreatePayload['gender'],
    preferred_language: values.language,
    reminders_enabled: messageContactAvailable && values.remindersEnabled,
    allow_shared_mobile: allowSharedMobile,
  };
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger },
  warning: {
    borderWidth: 1,
    borderColor: '#F0B429',
    backgroundColor: '#FFF8E6',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  warningTitle: { color: colors.warning, fontSize: 16, fontWeight: '800' },
  candidate: { gap: spacing.xs, paddingVertical: spacing.xs },
  candidateName: { fontWeight: '700', color: colors.text },
  meta: { color: colors.muted, lineHeight: 20 },
});
