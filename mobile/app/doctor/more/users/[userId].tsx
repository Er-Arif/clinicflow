import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { useGetAdminUserQuery, useListRolePresetsQuery, useMeQuery, useResetAdminUserPasswordMutation, useUpdateAdminUserMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { RolePicker } from '@/features/admin/RolePicker';
import { colors, radius, spacing } from '@/theme/tokens';

export default function EditUserScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const user = useGetAdminUserQuery(userId);
  const roles = useListRolePresetsQuery();
  const me = useMeQuery();
  const [updateUser, updateState] = useUpdateAdminUserMutation();
  const [resetPassword, resetState] = useResetAdminUserPasswordMutation();
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [active, setActive] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [resetReason, setResetReason] = useState('Administrative password reset');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user.data) return;
    setName(user.data.display_name); setLogin(user.data.login_identifier); setActive(user.data.active); setSelectedRoles(user.data.roles);
  }, [user.data]);

  async function save() {
    if (!user.data) return;
    setMessage(null);
    try {
      await updateUser({ userId, body: { expected_version: user.data.version, display_name: name.trim(), login_identifier: login.trim(), active, role_codes: selectedRoles } }).unwrap();
      setMessage('User saved.');
    } catch (error) {
      const e = error as { data?: { error?: { message?: string } } };
      setMessage(e.data?.error?.message ?? 'Unable to save user.');
    }
  }

  async function reset() {
    if (temporaryPassword.length < 10 || !resetReason.trim()) return;
    setMessage(null);
    try {
      await resetPassword({ userId, temporary_password: temporaryPassword, reason: resetReason.trim() }).unwrap();
      setTemporaryPassword('');
      setMessage('Temporary password set and active sessions revoked.');
    } catch (error) {
      const e = error as { data?: { error?: { message?: string } } };
      setMessage(e.data?.error?.message ?? 'Unable to reset password.');
    }
  }

  const editingSelf = me.data?.user_id === userId;
  return (
    <AppScreen refreshing={user.isFetching} onRefresh={() => void user.refetch()}>
      <BackButton />
      <Text style={styles.title}>Edit User</Text>
      {user.isLoading ? <ActivityIndicator /> : null}
      <TextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} />
      <TextInput style={styles.input} autoCapitalize="none" placeholder="Login identifier" value={login} onChangeText={setLogin} />
      <Text style={styles.heading}>Roles</Text>
      <RolePicker roles={roles.data ?? []} selected={selectedRoles} onChange={setSelectedRoles} />
      <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.heading}>Account active</Text><Text style={styles.subtitle}>{editingSelf ? 'You cannot disable your own account.' : 'Disabled users cannot authenticate.'}</Text></View><Switch value={active} disabled={editingSelf} onValueChange={setActive} /></View>
      {user.data?.must_change_password ? <Text style={styles.warning}>This user must change their temporary password.</Text> : null}
      <AppButton label="Save User" loading={updateState.isLoading} disabled={!user.data || !name.trim() || !login.trim() || selectedRoles.length === 0} onPress={save} />

      <View style={styles.divider} />
      <Text style={styles.heading}>Reset Password</Text>
      <Text style={styles.subtitle}>Sets a temporary password and immediately revokes the user&apos;s active sessions.</Text>
      <TextInput style={styles.input} secureTextEntry placeholder="New temporary password" value={temporaryPassword} onChangeText={setTemporaryPassword} />
      <TextInput style={styles.input} placeholder="Reason" value={resetReason} onChangeText={setResetReason} />
      <AppButton label="Reset Password" tone="danger" loading={resetState.isLoading} disabled={editingSelf || temporaryPassword.length < 10 || !resetReason.trim()} onPress={reset} />
      {message ? <Text style={message.includes('saved') || message.includes('set and') ? styles.success : styles.error}>{message}</Text> : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' }, title: { fontSize: 28, fontWeight: '900', color: colors.text },
  heading: { fontSize: 17, fontWeight: '900', color: colors.text }, subtitle: { color: colors.muted, lineHeight: 20 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  warning: { color: colors.warning, fontWeight: '700' }, success: { color: colors.success, fontWeight: '700' }, error: { color: colors.danger, fontWeight: '700' },
});
