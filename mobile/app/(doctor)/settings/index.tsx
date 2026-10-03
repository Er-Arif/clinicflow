import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useLogoutMutation, useMeQuery } from '@/api/api';
import { clearSessionTokens } from '@/auth/session';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, spacing } from '@/theme/tokens';

export default function SettingsHubScreen() {
  const router = useRouter();
  const me = useMeQuery();
  const [logout, logoutState] = useLogoutMutation();
  const owner = me.data?.roles.includes('OWNER_ADMIN') ?? false;

  async function signOut() {
    try { await logout().unwrap(); } catch { /* clear local session even if network is down */ }
    await clearSessionTokens();
    router.replace('/(auth)/login');
  }

  return (
    <AppScreen>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>{me.data?.display_name ?? 'ClinicFlow account'}</Text>

      {owner ? (
        <View style={styles.group}>
          <Text style={styles.heading}>Clinic administration</Text>
          <AppButton label="Clinic" onPress={() => router.push('/(doctor)/settings/clinic')} />
          <AppButton label="Doctor" tone="secondary" onPress={() => router.push('/(doctor)/settings/doctor')} />
          <AppButton label="Schedule" tone="secondary" onPress={() => router.push('/(doctor)/settings/schedule')} />
          <AppButton label="Fees" tone="secondary" onPress={() => router.push('/(doctor)/settings/fees')} />
          <AppButton label="UPI" tone="secondary" onPress={() => router.push('/(doctor)/settings/upi')} />
          <AppButton label="Message Templates" tone="secondary" onPress={() => router.push('/(doctor)/settings/messages')} />
          <AppButton label="Users" tone="secondary" onPress={() => router.push('/(doctor)/settings/users')} />
          <AppButton label="Audit History" tone="secondary" onPress={() => router.push('/(doctor)/settings/audit')} />
        </View>
      ) : null}

      <View style={styles.group}>
        <Text style={styles.heading}>Account</Text>
        <AppButton label="About ClinicFlow" tone="secondary" onPress={() => router.push('/(doctor)/settings/about')} />
        <AppButton label="Change Password" tone="secondary" onPress={() => router.push('/(auth)/change-password')} />
        <AppButton label="Sign Out" tone="danger" loading={logoutState.isLoading} onPress={signOut} />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 30, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted },
  group: { gap: spacing.sm, marginTop: spacing.md },
  heading: { fontSize: 18, fontWeight: '900', color: colors.text },
});
