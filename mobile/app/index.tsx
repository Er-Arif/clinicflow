import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { api } from '@/api/api';
import { getInitialRouteForRoles } from '@/auth/session';
import { bootstrapSession } from '@/auth/bootstrap';
import { AppButton } from '@/components/AppButton';
import { resetApiCache, store } from '@/store/store';
import { colors, radius, spacing } from '@/theme/tokens';

export default function Index() {
  const router = useRouter();
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [showRetry, setShowRetry] = useState(false);

  useEffect(() => {
    let mounted = true;
    setShowRetry(false);

    void bootstrapSession().then((result) => {
      if (!mounted) return;

      if (result.status === 'retry') {
        setShowRetry(true);
        return;
      }

      if (result.status === 'signed-out') {
        resetApiCache();
        router.replace('/(auth)/login');
        return;
      }

      const { tokens } = result;
      store.dispatch(api.util.upsertQueryData('me', undefined, tokens.user));
      if (tokens.user.must_change_password) {
        router.replace('/(auth)/change-password');
        return;
      }
      router.replace(getInitialRouteForRoles(tokens.user.roles));
    });

    return () => {
      mounted = false;
    };
  }, [retryAttempt, router]);

  return (
    <SafeAreaView style={styles.screen}>
      {showRetry ? (
        <View style={styles.retryCard}>
          <Text style={styles.retryTitle}>ClinicFlow is temporarily unreachable</Text>
          <Text style={styles.retryText}>
            Your session is still saved. Check your connection and try again.
          </Text>
          <AppButton label="Retry" onPress={() => setRetryAttempt((value) => value + 1)} />
        </View>
      ) : (
        <ActivityIndicator size="large" />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  retryCard: {
    width: '100%',
    maxWidth: 420,
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  retryTitle: {
    color: colors.primaryDark,
    fontSize: 20,
    fontWeight: '800',
  },
  retryText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.xs,
  },
});
