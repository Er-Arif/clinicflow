import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, } from 'react-native';

import { useCreateAdminUserMutation, useListRolePresetsQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { RolePicker } from '@/features/admin/RolePicker';
import { colors, radius, spacing } from '@/theme/tokens';

export default function NewUserScreen() {
  const router = useRouter();
  const roles = useListRolePresetsQuery();
  const [create, state] = useCreateAdminUserMutation();
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>(['ASSISTANT']);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setMessage(null);
    try {
      const user = await create({ display_name: name.trim(), login_identifier: login.trim(), temporary_password: password, role_codes: selectedRoles }).unwrap();
      router.replace(`/doctor/more/users/${user.user_id}`);
    } catch (error) {
      const e = error as { data?: { error?: { message?: string } } };
      setMessage(e.data?.error?.message ?? 'Unable to create user.');
    }
  }

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <Text style={styles.title}>Add User</Text>
      <KeyboardSafeTextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} />
      <KeyboardSafeTextInput style={styles.input} autoCapitalize="none" placeholder="Login identifier" value={login} onChangeText={setLogin} />
      <KeyboardSafeTextInput style={styles.input} secureTextEntry placeholder="Temporary password (10+ characters)" value={password} onChangeText={setPassword} />
      <Text style={styles.heading}>Roles</Text>
      <RolePicker roles={roles.data ?? []} selected={selectedRoles} onChange={setSelectedRoles} />
      <Text style={styles.subtitle}>The user must change the temporary password after first sign-in.</Text>
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <AppButton label="Create User" loading={state.isLoading} disabled={!name.trim() || !login.trim() || password.length < 10 || selectedRoles.length === 0} onPress={submit} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' }, title: { fontSize: 28, fontWeight: '900', color: colors.text },
  heading: { fontSize: 17, fontWeight: '900', color: colors.text }, subtitle: { color: colors.muted, lineHeight: 20 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  error: { color: colors.danger, fontWeight: '700' },
});

