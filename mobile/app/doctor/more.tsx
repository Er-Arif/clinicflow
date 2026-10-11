import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useLogoutMutation, useGetSystemInfoQuery, useMeQuery } from '@/api/api';
import { clearSessionTokens } from '@/auth/session';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function DoctorMoreScreen() {
  const router = useRouter();
  const [logoutMutation, logoutState] = useLogoutMutation();
  const systemInfo = useGetSystemInfoQuery();
  const me = useMeQuery();
  const owner = Boolean(me.data?.roles.includes('OWNER_ADMIN'));

  const handleLogout = async () => {
    try {
      await logoutMutation().unwrap();
    } catch {
      // Clear local session even if network is unavailable
    }
    await clearSessionTokens();
    router.replace('/(auth)/login');
  };

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={{ gap: spacing.lg }}>
        <View>
          <Text style={styles.title}>More</Text>
          <Text style={styles.subtitle}>{me.data?.display_name ?? 'Doctor'}</Text>
        </View>

        {owner ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Clinic Administration</Text>
            <MenuItem label="Clinic Settings" onPress={() => router.push('/doctor/settings/clinic')} />
            <MenuItem label="Doctor Settings" onPress={() => router.push('/doctor/settings/doctor')} />
            <MenuItem label="Schedule & Sessions" onPress={() => router.push('/doctor/settings/schedule')} />
            <MenuItem label="Consultation Fees" onPress={() => router.push('/doctor/settings/fees')} />
            <MenuItem label="UPI Payment Configuration" onPress={() => router.push('/doctor/settings/upi')} />
            <MenuItem label="Message Templates" onPress={() => router.push('/doctor/settings/messages')} />
            <MenuItem label="User Management" onPress={() => router.push('/doctor/settings/users')} />
            <MenuItem label="Audit History" onPress={() => router.push('/doctor/settings/audit')} />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <MenuItem label="Change Password" onPress={() => router.push('/(auth)/change-password')} />
          <MenuItem
            label={logoutState.isLoading ? 'Signing out…' : 'Sign Out'}
            onPress={() => void handleLogout()}
            textStyle={{ color: colors.danger }}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <MenuItem label="About ClinicFlow" onPress={() => router.push('/doctor/settings/about')} />
          <View style={styles.card}>
            <Text style={styles.text}>ClinicFlow V1</Text>
            {systemInfo.data ? (
              <Text style={styles.subtitle}>API: {systemInfo.data.api_version} · {systemInfo.data.environment}</Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

function MenuItem({ label, onPress, textStyle }: { label: string; onPress: () => void; textStyle?: object }) {
  return (
    <Pressable style={styles.card} onPress={onPress}>
      <Text style={[styles.text, textStyle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 4 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  text: { fontSize: 16, fontWeight: '700', color: colors.text },
});
