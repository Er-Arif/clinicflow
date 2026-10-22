import { QueryState } from '@/components/QueryState';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useListUsersQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

const roleLabel = (role: string) => {
  const normalized = role.toLowerCase().replaceAll('_', ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export default function UsersScreen() {
  const router = useRouter();
  const users = useListUsersQuery();
  return (
    <AppScreen refreshing={users.isFetching} onRefresh={() => void users.refetch()}>
      <BackButton />
      <Text style={styles.title}>User management</Text>
      <Text style={styles.subtitle}>Manage who can access ClinicFlow and the roles assigned to each account.</Text>
      <AppButton label="Add user" onPress={() => router.push('/doctor/more/users/new')} />
      <QueryState query={users} label="users" hasData={Boolean(users.currentData)} empty={users.currentData?.items.length === 0 ? 'No user accounts found.' : undefined} />
      {users.currentData?.items.map((user) => (
        <Pressable key={user.user_id} style={styles.card} onPress={() => router.push(`/doctor/more/users/${user.user_id}`)} accessibilityRole="button" accessibilityLabel={`Manage ${user.display_name}`}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user.display_name}</Text>
              <Text style={styles.subtitle}>{user.login_identifier}</Text>
              <Text style={styles.meta}>{user.roles.map(roleLabel).join(' · ') || 'No role'}</Text>
              {user.must_change_password ? <Text style={styles.warning}>Temporary password must be changed</Text> : null}
            </View>
            <View style={styles.cardRight}>
              <Text style={user.active ? styles.active : styles.disabled}>{user.active ? 'Active' : 'Disabled'}</Text>
              <Text style={styles.manage}>Manage ›</Text>
            </View>
          </View>
        </Pressable>
      ))}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  name: { fontSize: 17, fontWeight: '900', color: colors.text },
  meta: { marginTop: 5, color: colors.muted, fontSize: 12 },
  warning: { marginTop: 5, color: colors.warning, fontWeight: '700', fontSize: 12 },
  cardRight: { alignItems: 'flex-end', gap: 8 },
  active: { color: colors.success, fontWeight: '800' },
  disabled: { color: colors.danger, fontWeight: '800' },
  manage: { color: colors.primary, fontWeight: '800', fontSize: 12 },
});
