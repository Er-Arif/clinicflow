import { QueryState } from '@/components/QueryState';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { useGetDoctorSettingsQuery, useListDoctorsQuery, useUpdateDoctorSettingsMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { FormField } from '@/components/FormField';
import { colors } from '@/theme/tokens';

export default function DoctorSettingsScreen() {
  const doctors = useListDoctorsQuery();
  const doctorId = doctors.data?.[0]?.doctor_id ?? '';
  const settings = useGetDoctorSettingsQuery(doctorId, { skip: !doctorId });
  const [save, saveState] = useUpdateDoctorSettingsMutation();
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    setName(settings.data.display_name);
    setDetails(settings.data.professional_display_details ?? '');
  }, [settings.data]);

  async function submit() {
    if (!settings.data || !doctorId) return;
    setMessage(null);
    try {
      await save({ doctorId, body: { display_name: name.trim(), professional_display_details: details.trim() || null, expected_version: settings.data.version } }).unwrap();
      setMessage('Profile saved.');
    } catch (error) {
      const e = error as { data?: { error?: { message?: string } } };
      setMessage(e.data?.error?.message ?? 'Unable to save profile.');
    }
  }

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <QueryState query={doctors} label="doctors" />
      <QueryState query={settings} label="profile" />
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>Name and professional details shown across ClinicFlow.</Text>
      {!doctorId && doctors.isSuccess ? <Text style={styles.error}>No active doctor is configured.</Text> : null}
      <FormField
        label="Display name"
        placeholder="e.g. Dr Arif Ali"
        value={name}
        onChangeText={setName}
        editable={!saveState.isLoading}
      />
      <FormField
        label="Professional details"
        placeholder="e.g. Qualifications, specialty or designation"
        multiline
        value={details}
        onChangeText={setDetails}
        editable={!saveState.isLoading}
        style={styles.multiline}
      />
      <Text style={styles.helper}>Shown anywhere ClinicFlow displays the doctor’s professional identity.</Text>
      {message ? <Text style={message.includes('saved') ? styles.success : styles.error}>{message}</Text> : null}
      <AppButton label="Save profile" loading={saveState.isLoading} disabled={!settings.data || !name.trim()} onPress={submit} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  multiline: { minHeight: 92 },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  success: { color: colors.success, fontWeight: '700' },
  error: { color: colors.danger, fontWeight: '700' },
});
