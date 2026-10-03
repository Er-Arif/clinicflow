import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Provider } from 'react-redux';

import { subscribeSessionExpired } from '@/auth/sessionEvents';
import { store } from '@/store/store';

export default function RootLayout() {
  const router = useRouter();

  useEffect(
    () => subscribeSessionExpired(() => {
      router.replace({ pathname: '/(auth)/login', params: { reason: 'session-expired' } });
    }),
    [router],
  );

  return (
    <Provider store={store}>
      <Stack screenOptions={{ headerShown: false }} />
    </Provider>
  );
}
