import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput } from 'react-native';
import { useRouter } from 'expo-router';

import { useGetClinicSettingsQuery, useUpdateClinicSettingsMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function ClinicSettingsScreen() {
  const router = useRouter();
  const query = useGetClinicSettingsQuery();
  const [save, saveState] = useUpdateClinicSettingsMutation();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    setName(query.data.clinic_name);
    setAddress(query.data.address ?? '');
    setContact(query.data.contact_number ?? '');
  }, [query.data]);

  async function submit() {
    if (!query.data) return;
    setMessage(null);
    try {
      await save({ clinic_name: name.trim(), address: address.trim() || null, contact_number: contact.trim() || null, expected_version: query.data.version }).unwrap();
      setMessage('Clinic settings saved.');
    } catch (error) {
      const e = error as { data?: { error?: { message?: string } } };
      setMessage(e.data?.error?.message ?? 'Unable to save clinic settings.');
    }
  }

  return (
    <AppScreen>
      <Text style={styles.link} onPress={() => router.back()}>Back</Text>
      <Text style={styles.title}>Clinic Settings</Text>
      {query.isLoading ? <ActivityIndicator /> : null}
      <TextInput style={styles.input} placeholder="Clinic name" value={name} onChangeText={setName} />
      <TextInput style={[styles.input, styles.multiline]} placeholder="Address" multiline value={address} onChangeText={setAddress} />
      <TextInput style={styles.input} placeholder="Contact number" keyboardType="phone-pad" value={contact} onChangeText={setContact} />
      {message ? <Text style={message.includes('saved') ? styles.success : styles.error}>{message}</Text> : null}
      <AppButton label="Save Changes" loading={saveState.isLoading} disabled={!query.data || !name.trim()} onPress={submit} />
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
