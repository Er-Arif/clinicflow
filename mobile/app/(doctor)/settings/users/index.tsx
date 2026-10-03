import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useListUsersQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function UsersScreen() {
  const router = useRouter();
  const users = useListUsersQuery();
  return (
    <AppScreen refreshing={users.isFetching} onRefresh={() => void users.refetch()}>
      <Text style={styles.link} onPress={() => router.back()}>Back</Text>
      <Text style={styles.title}>Users</Text>
      <Text style={styles.subtitle}>Individual accounts with server-defined ClinicFlow roles.</Text>
      <AppButton label="Add User" onPress={() => router.push('/(doctor)/settings/users/new')} />
      {users.isLoading ? <ActivityIndicator /> : null}
      {users.data?.items.map((user) => (
        <Pressable key={user.user_id} style={styles.card} onPress={() => router.push(`/(doctor)/settings/users/${user.user_id}`)}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{user.display_name}</Text>
              <Text style={styles.subtitle}>{user.login_identifier}</Text>
              <Text style={styles.meta}>{user.roles.join(' · ') || 'No role'}</Text>
              {user.must_change_password ? <Text style={styles.warning}>Temporary password must be changed</Text> : null}
            </View>
            <Text style={user.active ? styles.active : styles.disabled}>{user.active ? 'Active' : 'Disabled'}</Text>
          </View>
        </Pressable>
      ))}
      {!users.isLoading && users.data?.items.length === 0 ? <Text style={styles.subtitle}>No user accounts found.</Text> : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  name: { fontSize: 17, fontWeight: '900', color: colors.text },
  meta: { marginTop: 5, color: colors.muted, fontSize: 12 },
  warning: { marginTop: 5, color: colors.warning, fontWeight: '700', fontSize: 12 },
  active: { color: colors.success, fontWeight: '800' },
  disabled: { color: colors.danger, fontWeight: '800' },
});
