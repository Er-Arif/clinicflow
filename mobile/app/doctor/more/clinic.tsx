import { QueryState } from '@/components/QueryState';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { useGetClinicSettingsQuery, useUpdateClinicSettingsMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { FormField } from '@/components/FormField';
import { colors } from '@/theme/tokens';

export default function ClinicSettingsScreen() {
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
      await save({
        clinic_name: name.trim(),
        address: address.trim() || null,
        contact_number: contact.trim() || null,
        expected_version: query.data.version,
      }).unwrap();
      setMessage('Clinic settings saved.');
    } catch (error) {
      const e = error as { data?: { error?: { message?: string } } };
      setMessage(e.data?.error?.message ?? 'Unable to save clinic settings.');
    }
  }

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <QueryState query={query} label="clinic settings" />
      <Text style={styles.title}>Clinic settings</Text>
      <Text style={styles.subtitle}>Clinic identity and contact details used across ClinicFlow.</Text>

      <FormField label="Clinic name" value={name} onChangeText={setName} placeholder="Clinic name" />
      <FormField label="Address" value={address} onChangeText={setAddress} placeholder="Clinic address" multiline />
      <FormField label="Contact number" value={contact} onChangeText={setContact} placeholder="Clinic contact number" keyboardType="phone-pad" />

      {message ? <Text style={message.includes('saved') ? styles.success : styles.error}>{message}</Text> : null}
      <AppButton label="Save changes" loading={saveState.isLoading} disabled={!query.data || !name.trim()} onPress={submit} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  success: { color: colors.success, fontWeight: '700' },
  error: { color: colors.danger, fontWeight: '700' },
});
