import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { api, useLoginMutation } from '@/api/api';
import { getInitialRouteForRoles, setSessionTokens } from '@/auth/session';
import { resetApiCache, store } from '@/store/store';

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reason?: string }>();
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [login, state] = useLoginMutation();

  async function submit() {
    if (!loginIdentifier.trim() || !password) return;
    try {
      const tokens = await login({
        login_identifier: loginIdentifier.trim(),
        password,
        device_label: 'ClinicFlow Android',
      }).unwrap();
      resetApiCache();
      await setSessionTokens(tokens);
      store.dispatch(api.util.upsertQueryData('me', undefined, tokens.user));
      if (tokens.user.must_change_password) {
        router.replace('/(auth)/change-password');
        return;
      }
      router.replace(getInitialRouteForRoles(tokens.user.roles));
    } catch {
      // Structured backend error is presented from state.error below.
    }
  }

  const errorMessage =
    state.error && 'data' in state.error
      ? ((state.error.data as { error?: { message?: string } })?.error?.message ?? 'Sign in failed.')
      : state.error
        ? 'Unable to reach ClinicFlow. Check your connection.'
        : params.reason === 'session-expired'
          ? 'Your session has expired. Sign in again to continue.'
          : null;

  return (
    <KeyboardSafeFormScreen contentStyle={styles.screen}>
      <View style={styles.card}>
        <Image
          source={require('../../assets/clinicflow-lockup.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="ClinicFlow — Appointments · Payments · Follow-ups"
        />
        <View style={styles.form}>
          <KeyboardSafeTextInput
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Username / Mobile / Email"
            value={loginIdentifier}
            onChangeText={setLoginIdentifier}
            style={styles.input}
          />
          <KeyboardSafeTextInput
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={state.isLoading || !loginIdentifier.trim() || !password}
            onPress={submit}
            style={({ pressed }) => [
              styles.button,
              (state.isLoading || !loginIdentifier.trim() || !password) && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            {state.isLoading ? <ActivityIndicator /> : <Text style={styles.buttonText}>Sign In</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F7FAFC' },
  card: { gap: 12 },
  logo: { width: '100%', height: 80, alignSelf: 'center', marginBottom: 8 },
  brand: { fontSize: 32, fontWeight: '700', color: '#1264A3' },
  tagline: { fontSize: 16, color: '#475569' },
  form: { marginTop: 24, gap: 14 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  error: { color: '#B42318' },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#1264A3',
    paddingVertical: 15,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});

