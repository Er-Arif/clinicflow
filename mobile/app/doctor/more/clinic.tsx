import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, } from 'react-native';

import { useGetClinicSettingsQuery, useUpdateClinicSettingsMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

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
      await save({ clinic_name: name.trim(), address: address.trim() || null, contact_number: contact.trim() || null, expected_version: query.data.version }).unwrap();
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
      <Text style={styles.title}>Clinic Settings</Text>

      <KeyboardSafeTextInput style={styles.input} placeholder="Clinic name" value={name} onChangeText={setName} />
      <KeyboardSafeTextInput style={[styles.input, styles.multiline]} placeholder="Address" multiline value={address} onChangeText={setAddress} />
      <KeyboardSafeTextInput style={styles.input} placeholder="Contact number" keyboardType="phone-pad" value={contact} onChangeText={setContact} />
      {message ? <Text style={message.includes('saved') ? styles.success : styles.error}>{message}</Text> : null}
      <AppButton label="Save Changes" loading={saveState.isLoading} disabled={!query.data || !name.trim()} onPress={submit} />
    </KeyboardSafeFormScreen>
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
