import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { useGetDoctorSettingsQuery, useListDoctorsQuery, useUpdateDoctorSettingsMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function DoctorSettingsScreen() {
  const router = useRouter();
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
      setMessage('Doctor settings saved.');
    } catch (error) {
      const e = error as { data?: { error?: { message?: string } } };
      setMessage(e.data?.error?.message ?? 'Unable to save doctor settings.');
    }
  }

  return (
    <AppScreen>
      <Text style={styles.link} onPress={() => router.back()}>Back</Text>
      <Text style={styles.title}>Doctor Settings</Text>
      {doctors.isLoading || settings.isLoading ? <ActivityIndicator /> : null}
      {!doctorId && !doctors.isLoading ? <Text style={styles.error}>No active doctor is configured.</Text> : null}
      <TextInput style={styles.input} placeholder="Doctor name" value={name} onChangeText={setName} />
      <TextInput style={[styles.input, styles.multiline]} placeholder="Professional display details" multiline value={details} onChangeText={setDetails} />
      {message ? <Text style={message.includes('saved') ? styles.success : styles.error}>{message}</Text> : null}
      <AppButton label="Save Changes" loading={saveState.isLoading} disabled={!settings.data || !name.trim()} onPress={submit} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  multiline: { minHeight: 92, paddingTop: 12, textAlignVertical: 'top' },
  success: { color: colors.success, fontWeight: '700' },
  error: { color: colors.danger, fontWeight: '700' },
});
