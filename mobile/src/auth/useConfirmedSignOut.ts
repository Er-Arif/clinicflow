import { Alert } from 'react-native';
import { useRouter } from 'expo-router';

import { useLogoutMutation } from '@/api/api';
import { clearSessionTokens } from '@/auth/session';
import { resetApiCache } from '@/store/store';

export function useConfirmedSignOut() {
  const router = useRouter();
  const [logout, logoutState] = useLogoutMutation();

  const signOut = async () => {
    try { await logout().unwrap(); } catch { /* Local sign out must still succeed. */ }
    await clearSessionTokens();
    resetApiCache();
    router.replace('/(auth)/login');
  };

  const confirmSignOut = () => {
    if (logoutState.isLoading) return;
    Alert.alert(
      'Sign out?',
      'You’ll need to sign in again to continue.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => { void signOut(); } },
      ],
    );
  };

  return { confirmSignOut, isSigningOut: logoutState.isLoading };
}
