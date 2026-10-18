import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { useGetDoctorSettingsQuery, useListDoctorsQuery, useUpdateDoctorSettingsMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

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
      <KeyboardSafeTextInput style={styles.input} placeholder="Doctor name" value={name} onChangeText={setName} />
      <KeyboardSafeTextInput style={[styles.input, styles.multiline]} placeholder="Professional display details" multiline value={details} onChangeText={setDetails} />
      {message ? <Text style={message.includes('saved') ? styles.success : styles.error}>{message}</Text> : null}
      <AppButton label="Save Profile" loading={saveState.isLoading} disabled={!settings.data || !name.trim()} onPress={submit} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  multiline: { minHeight: 92, paddingTop: 12, textAlignVertical: 'top' },
  success: { color: colors.success, fontWeight: '700' },
  error: { color: colors.danger, fontWeight: '700' },
});
