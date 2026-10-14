import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, } from 'react-native';

import { useChangePasswordMutation, useMeQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

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

  return (
    <KeyboardSafeFormScreen>
      {!me.data?.must_change_password ? <BackButton /> : null}
      <Text style={styles.brand}>ClinicFlow</Text>
      <Text style={styles.title}>Change Password</Text>
      <Text style={styles.subtitle}>
        {me.data?.must_change_password
          ? 'Your administrator issued a temporary password. Choose a new password before continuing.'
          : 'Update your ClinicFlow password.'}
      </Text>
      <KeyboardSafeTextInput style={styles.input} placeholder="Current password" secureTextEntry value={current} onChangeText={setCurrent} />
      <KeyboardSafeTextInput style={styles.input} placeholder="New password" secureTextEntry value={next} onChangeText={setNext} />
      <KeyboardSafeTextInput style={styles.input} placeholder="Confirm new password" secureTextEntry value={confirm} onChangeText={setConfirm} />
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <AppButton label="Change Password" loading={state.isLoading} disabled={!current || !next || !confirm} onPress={submit} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  brand: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  title: { color: colors.text, fontSize: 28, fontWeight: '900' },
  subtitle: { color: colors.muted, lineHeight: 21 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  error: { color: colors.danger, fontWeight: '700' },
});

