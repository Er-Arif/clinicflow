import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Provider } from 'react-redux';

import { subscribeSessionExpired } from '@/auth/sessionEvents';
import { resetApiCache, store } from '@/store/store';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  const router = useRouter();

  useEffect(
    () => subscribeSessionExpired(() => {
      resetApiCache();
      router.replace({ pathname: '/(auth)/login', params: { reason: 'session-expired' } });
    }),
    [router],
  );

  return (
    <Provider store={store}>
      <StatusBar style="dark" backgroundColor={colors.background} translucent={false} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </Provider>
  );
}
