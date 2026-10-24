import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';

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
  const [active, setActive] = useState(false);

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
  const hasRequiredDetails = upiId.trim().length >= 3 && payeeName.trim().length >= 1;
  if (config.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <Text style={styles.title}>Payment settings</Text>
      <Text style={styles.subtitle}>{missing ? 'Add the clinic UPI details before enabling UPI payments.' : 'Clinic payment details used to generate UPI QR codes.'}</Text>

      <Text style={styles.label}>UPI ID</Text>
      <KeyboardSafeTextInput
        value={upiId}
        onChangeText={setUpiId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="clinic@upi"
        style={styles.input}
      />

      <Text style={styles.label}>Payee name</Text>
      <KeyboardSafeTextInput value={payeeName} onChangeText={setPayeeName} placeholder="Clinic name" style={styles.input} />

      <View style={styles.toggle}>
        <View style={styles.toggleCopy}>
          <Text style={styles.label}>UPI payments</Text>
          <Text style={styles.toggleHint}>{active ? 'UPI can be offered during payment collection.' : 'UPI is unavailable during payment collection.'}</Text>
        </View>
        <Switch value={active} onValueChange={setActive} disabled={!hasRequiredDetails && !config.data} />
      </View>

      {!hasRequiredDetails ? <Text style={styles.hint}>Enter a valid UPI ID and payee name before enabling UPI.</Text> : null}
      {updateState.data ? <Text style={styles.success}>Payment settings saved.</Text> : null}
      {updateState.error ? <Text style={styles.error}>{apiError(updateState.error)?.message ?? 'Unable to save payment settings.'}</Text> : null}
      <AppButton label="Save payment settings" loading={updateState.isLoading} disabled={!hasRequiredDetails} onPress={() => void save()} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  label: { color: colors.text, fontWeight: '700' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.surface },
  toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  toggleCopy: { flex: 1, gap: 3 },
  toggleHint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  success: { color: colors.success },
  error: { color: colors.danger },
});
