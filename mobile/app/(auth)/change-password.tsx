import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { useChangePasswordMutation, useMeQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { FormField } from '@/components/FormField';
import { colors } from '@/theme/tokens';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const me = useMeQuery();
  const [changePassword, state] = useChangePasswordMutation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setMessage(null);
    if (next.length < 10) return setMessage('New password must contain at least 10 characters.');
    if (next !== confirm) return setMessage('New password and confirmation do not match.');
    try {
      await changePassword({ current_password: current, new_password: next }).unwrap();
      const refreshed = await me.refetch().unwrap();
      const doctorOwner = refreshed.roles.some((role) => ['DOCTOR', 'OWNER_ADMIN'].includes(role));
      router.replace(doctorOwner ? '/doctor/today' : '/assistant/home');
    } catch (error) {
      const detail = error as { data?: { error?: { message?: string } } };
      setMessage(detail.data?.error?.message ?? 'Unable to change password.');
    }
  }

  const mustChangePassword = Boolean(me.data?.must_change_password);

  return (
    <KeyboardSafeFormScreen>
      {!mustChangePassword ? <BackButton /> : null}
      {mustChangePassword ? <Text style={styles.brand}>ClinicFlow</Text> : null}
      <Text style={styles.title}>Change password</Text>
      <Text style={styles.subtitle}>
        {mustChangePassword
          ? 'Your administrator issued a temporary password. Choose a new password before continuing.'
          : 'Choose a new password for your ClinicFlow account.'}
      </Text>
      <FormField
        label="Current password"
        placeholder="Enter current password"
        secureTextEntry
        value={current}
        onChangeText={setCurrent}
        editable={!state.isLoading}
      />
      <FormField
        label="New password"
        placeholder="At least 10 characters"
        secureTextEntry
        value={next}
        onChangeText={setNext}
        editable={!state.isLoading}
      />
      <Text style={styles.helper}>Use at least 10 characters.</Text>
      <FormField
        label="Confirm new password"
        placeholder="Re-enter new password"
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
        editable={!state.isLoading}
      />
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <AppButton label="Change password" loading={state.isLoading} disabled={!current || !next || !confirm} onPress={submit} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  brand: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  title: { color: colors.text, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, lineHeight: 21 },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger, fontWeight: '700' },
});
