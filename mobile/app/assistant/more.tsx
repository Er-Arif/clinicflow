import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useLogoutMutation, useGetSystemInfoQuery, useMeQuery } from '@/api/api';
import { clearSessionTokens } from '@/auth/session';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function MoreScreen() {
  const router = useRouter();
  const [logoutMutation] = useLogoutMutation();
  const systemInfo = useGetSystemInfoQuery();
  const me = useMeQuery();

  const handleLogout = async () => {
    try {
      await logoutMutation().unwrap();
    } catch {
      // ignore
    }
    await clearSessionTokens();
    router.replace('/(auth)/login');
  };

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={{ gap: spacing.lg }}>
        <View>
          <Text style={styles.title}>More</Text>
          <Text style={styles.subtitle}>{me.data?.display_name ?? 'Assistant'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Operations</Text>
          <MenuItem label="Payments" onPress={() => router.push('/assistant/payments')} />
          <MenuItem label="Reminders" onPress={() => router.push('/assistant/reminders')} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <MenuItem label="My Account" onPress={() => router.push('/assistant/account')} />
          <MenuItem label="Change Password" onPress={() => router.push('/(auth)/change-password')} />
          <MenuItem label="Log Out" onPress={handleLogout} textStyle={{ color: colors.danger }} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
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

function MenuItem({ label, onPress, textStyle }: { label: string; onPress: () => void; textStyle?: any }) {
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

