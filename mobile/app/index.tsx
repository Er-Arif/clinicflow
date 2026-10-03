import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet } from 'react-native';

import { refreshSessionSingleFlight } from '@/api/api';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    void refreshSessionSingleFlight().then((tokens) => {
      if (!mounted) return;
      if (!tokens) {
        router.replace('/(auth)/login');
        return;
      }
      if (tokens.user.must_change_password) {
        router.replace('/(auth)/change-password');
        return;
      }
      const isDoctorOwner = tokens.user.roles.some((role) =>
        ['DOCTOR', 'OWNER_ADMIN'].includes(role),
      );
      router.replace(isDoctorOwner ? '/(doctor)/today' : '/(assistant)/home');
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
