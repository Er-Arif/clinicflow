import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';

import { useGetAdminUserQuery, useListRolePresetsQuery, useMeQuery, useResetAdminUserPasswordMutation, useUpdateAdminUserMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { FormField } from '@/components/FormField';
import { RolePicker } from '@/features/admin/RolePicker';
import { colors, spacing } from '@/theme/tokens';

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
    setName(user.data.display_name);
    setLogin(user.data.login_identifier);
    setActive(user.data.active);
    setSelectedRoles(user.data.roles);
  }, [user.data]);

  async function save() {
    if (!user.data) return;
    setMessage(null);
    try {
      await updateUser({
        userId,
        body: {
          expected_version: user.data.version,
          display_name: name.trim(),
          login_identifier: login.trim(),
          active,
          role_codes: selectedRoles,
        },
      }).unwrap();
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
    <KeyboardSafeFormScreen refreshing={user.isFetching} onRefresh={() => void user.refetch()}>
      <BackButton />
      <Text style={styles.title}>Edit User</Text>
      <Text style={styles.subtitle}>Update this account’s identity, access roles, and sign-in status.</Text>
      {user.isLoading ? <ActivityIndicator /> : null}

      <FormField
        label="Display name"
        placeholder="e.g. Staging Assistant"
        value={name}
        onChangeText={setName}
        editable={!updateState.isLoading}
      />
      <FormField
        label="Login identifier"
        placeholder="e.g. assistant_stage"
        autoCapitalize="none"
        value={login}
        onChangeText={setLogin}
        editable={!updateState.isLoading}
      />

      <Text style={styles.heading}>Roles</Text>
      <Text style={styles.helper}>Choose what this user is allowed to do in ClinicFlow.</Text>
      <RolePicker roles={roles.data ?? []} selected={selectedRoles} onChange={setSelectedRoles} />

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Account active</Text>
          <Text style={styles.subtitle}>{editingSelf ? 'You cannot disable your own account.' : 'Turn this off to prevent this user from signing in.'}</Text>
        </View>
        <Switch value={active} disabled={editingSelf} onValueChange={setActive} />
      </View>

      {user.data?.must_change_password ? <Text style={styles.warning}>This user must change their temporary password.</Text> : null}
      <AppButton label="Save user" loading={updateState.isLoading} disabled={!user.data || !name.trim() || !login.trim() || selectedRoles.length === 0} onPress={save} />

      <View style={styles.divider} />
      <Text style={styles.heading}>Reset password</Text>
      <Text style={styles.subtitle}>Set a temporary password and immediately sign this user out of any active sessions.</Text>
      <FormField
        label="Temporary password"
        placeholder="Enter at least 10 characters"
        secureTextEntry
        value={temporaryPassword}
        onChangeText={setTemporaryPassword}
        editable={!resetState.isLoading && !editingSelf}
      />
      <FormField
        label="Reason"
        placeholder="Why is the password being reset?"
        value={resetReason}
        onChangeText={setResetReason}
        editable={!resetState.isLoading && !editingSelf}
      />
      <Text style={styles.helper}>The reason is recorded with the administrative reset.</Text>
      <AppButton label="Reset password" tone="danger" loading={resetState.isLoading} disabled={editingSelf || temporaryPassword.length < 10 || !resetReason.trim()} onPress={reset} />

      {message ? <Text style={message.includes('saved') || message.includes('set and') ? styles.success : styles.error}>{message}</Text> : null}
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  heading: { fontSize: 17, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  helper: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  warning: { color: colors.warning, fontWeight: '700' },
  success: { color: colors.success, fontWeight: '700' },
  error: { color: colors.danger, fontWeight: '700' },
});
