import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { apiError } from '@/api/errors';
import { useGetUpiConfigurationQuery, useUpdateUpiConfigurationMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

export default function UpiSettingsScreen() {
  const config = useGetUpiConfigurationQuery();
  const [updateConfig, updateState] = useUpdateUpiConfigurationMutation();
  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (config.data) {
      setUpiId(config.data.upi_id);
      setPayeeName(config.data.payee_name);
      setActive(config.data.active);
    }
  }, [config.data]);

  async function save() {
    try {
      await updateConfig({
        upi_id: upiId.trim(),
        payee_name: payeeName.trim(),
        active,
        ...(config.data ? { expected_version: config.data.version } : {}),
      }).unwrap();
    } catch {
      // Error rendered below.
    }
  }

  const missing = apiError(config.error)?.code === 'UPI_NOT_CONFIGURED';
  if (config.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;

  return (
    <AppScreen>
      <BackButton />
      <Text style={styles.title}>UPI Settings</Text>
      <Text style={styles.subtitle}>{missing ? 'Configure UPI before accepting UPI payments.' : 'Clinic-wide payee details used to generate dynamic QR codes.'}</Text>
      <Text style={styles.label}>UPI ID</Text>
      <TextInput value={upiId} onChangeText={setUpiId} autoCapitalize="none" placeholder="clinic@upi" style={styles.input} />
      <Text style={styles.label}>Payee Name</Text>
      <TextInput value={payeeName} onChangeText={setPayeeName} placeholder="Clinic name" style={styles.input} />
      <View style={styles.toggle}><Text style={styles.label}>UPI enabled</Text><Switch value={active} onValueChange={setActive} /></View>
      {updateState.data ? <Text style={styles.success}>UPI settings saved.</Text> : null}
      {updateState.error ? <Text style={styles.error}>{apiError(updateState.error)?.message ?? 'Unable to save UPI settings.'}</Text> : null}
      <AppButton label="Save UPI Details" loading={updateState.isLoading} disabled={upiId.trim().length < 3 || payeeName.trim().length < 1} onPress={() => void save()} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted },
  label: { color: colors.text, fontWeight: '700' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.surface },
  toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  success: { color: colors.success },
  error: { color: colors.danger },
});
