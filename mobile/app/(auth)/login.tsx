import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api, useLoginMutation } from '@/api/api';
import { getInitialRouteForRoles, setSessionTokens } from '@/auth/session';
import { AppButton } from '@/components/AppButton';
import { ClinicFlowLogo } from '@/components/ClinicFlowLogo';
import { resetApiCache, store } from '@/store/store';
import { colors, radius, spacing } from '@/theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reason?: string }>();
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [login, state] = useLoginMutation();

  async function submit() {
    if (!loginIdentifier.trim() || !password) return;
    try {
      const tokens = await login({ login_identifier: loginIdentifier.trim(), password, device_label: 'ClinicFlow Android' }).unwrap();
      resetApiCache();
      await setSessionTokens(tokens);
      store.dispatch(api.util.upsertQueryData('me', undefined, tokens.user));
      if (tokens.user.must_change_password) { router.replace('/(auth)/change-password'); return; }
      router.replace(getInitialRouteForRoles(tokens.user.roles));
    } catch { /* rendered below */ }
  }

  const errorMessage = state.error && 'data' in state.error
    ? ((state.error.data as { error?: { message?: string } })?.error?.message ?? 'Sign in failed.')
    : state.error
      ? 'Unable to reach ClinicFlow. Check your connection.'
      : params.reason === 'session-expired'
        ? 'Session expired. Sign in again.'
        : null;

  return (
    <KeyboardSafeFormScreen contentStyle={styles.screen}>
      <View style={styles.shell}>
        <ClinicFlowLogo />
        <View style={styles.card}>
          <Text style={styles.heading}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your clinic workspace</Text>
          <View style={styles.form}>
            <KeyboardSafeTextInput autoCapitalize="none" autoCorrect={false} placeholder="Username, mobile or email" value={loginIdentifier} onChangeText={setLoginIdentifier} style={styles.input} />
            <KeyboardSafeTextInput placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} />
            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
            <AppButton label="Sign In" loading={state.isLoading} disabled={!loginIdentifier.trim() || !password} onPress={() => void submit()} />
          </View>
        </View>
      </View>
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  shell: { gap: spacing.lg },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.lg, gap: 4, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.06, shadowRadius: 18, elevation: 2 },
  heading: { fontSize: 24, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, fontSize: 14 },
  form: { marginTop: spacing.md, gap: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSoft, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.text },
  error: { color: colors.danger, fontSize: 13 },
});
