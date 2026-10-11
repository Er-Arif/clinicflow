import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet } from 'react-native';

import { api, refreshSessionSingleFlight } from '@/api/api';
import { getInitialRouteForRoles } from '@/auth/session';
import { resetApiCache, store } from '@/store/store';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    void refreshSessionSingleFlight().then((tokens) => {
      if (!mounted) return;
      if (!tokens) {
        resetApiCache();
        router.replace('/(auth)/login');
        return;
      }
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
  }, [router]);

  return (
    <SafeAreaView style={styles.screen}>
      <ActivityIndicator size="large" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7FAFC' },
});

