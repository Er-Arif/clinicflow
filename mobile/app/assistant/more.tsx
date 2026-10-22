import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useMeQuery } from '@/api/api';
import { useConfirmedSignOut } from '@/auth/useConfirmedSignOut';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function MoreScreen() {
  const router = useRouter();
  const me = useMeQuery();
  const { confirmSignOut, isSigningOut } = useConfirmedSignOut();

  return (
    <AppScreen>
      <View style={styles.header}>
        <Text style={styles.title}>{me.data?.display_name ?? 'Assistant'}</Text>
        <Text style={styles.subtitle}>Assistant workspace</Text>
      </View>
      <Section title="Operations">
        <MenuItem label="Payments" onPress={() => router.push('/assistant/payments')} />
        <MenuItem label="Reminders" onPress={() => router.push('/assistant/reminders')} />
      </Section>
      <Section title="Account">
        <MenuItem label="Change password" onPress={() => router.push('/(auth)/change-password')} />
        <MenuItem label={isSigningOut ? 'Signing out…' : 'Sign out'} onPress={confirmSignOut} danger />
      </Section>
      <MenuCard label="About" onPress={() => router.push('/about')} />
      <Text style={styles.version}>ClinicFlow V1</Text>
    </AppScreen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.sectionCard}>{children}</View></View>;
}

function MenuCard({ label, onPress }: { label: string; onPress: () => void }) {
  return <View style={styles.sectionCard}><MenuItem label={label} onPress={onPress} /></View>;
}

function MenuItem({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  return <Pressable accessibilityRole="button" style={({ pressed }) => [styles.item, pressed && styles.pressed]} onPress={onPress}><Text style={[styles.text, danger && styles.danger]}>{label}</Text><Text style={styles.chevron}>›</Text></Pressable>;
}

const styles = StyleSheet.create({
  header: { gap: 3 },
  title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, fontSize: 13 },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
  sectionCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  item: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  text: { fontSize: 15, fontWeight: '600', color: colors.text },
  danger: { color: colors.danger },
  chevron: { color: colors.muted, fontSize: 24, lineHeight: 26 },
  version: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: spacing.sm },
  pressed: { backgroundColor: colors.surfaceSoft },
});
