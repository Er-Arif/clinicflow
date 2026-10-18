import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { useCreateAdminUserMutation, useListRolePresetsQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { FormField } from '@/components/FormField';
import { RolePicker } from '@/features/admin/RolePicker';
import { colors } from '@/theme/tokens';

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
      const user = await create({
        display_name: name.trim(),
        login_identifier: login.trim(),
        temporary_password: password,
        role_codes: selectedRoles,
      }).unwrap();
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
      <Text style={styles.subtitle}>Create an account and choose what this user can access in ClinicFlow.</Text>

      <FormField
        label="Display name"
        placeholder="e.g. Reception Assistant"
        value={name}
        onChangeText={setName}
        editable={!state.isLoading}
      />
      <FormField
        label="Login identifier"
        placeholder="e.g. assistant_1"
        autoCapitalize="none"
        value={login}
        onChangeText={setLogin}
        editable={!state.isLoading}
      />
      <FormField
        label="Temporary password"
        placeholder="At least 10 characters"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        editable={!state.isLoading}
      />

      <Text style={styles.heading}>Roles</Text>
      <Text style={styles.helper}>Choose what this user is allowed to do in ClinicFlow.</Text>
      <RolePicker roles={roles.data ?? []} selected={selectedRoles} onChange={setSelectedRoles} />

      <Text style={styles.notice}>The user will be required to change the temporary password after first sign-in.</Text>
      {message ? <Text style={styles.error}>{message}</Text> : null}
      <AppButton
        label="Create user"
        loading={state.isLoading}
        disabled={!name.trim() || !login.trim() || password.length < 10 || selectedRoles.length === 0}
        onPress={submit}
      />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  heading: { fontSize: 17, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  notice: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger, fontWeight: '700' },
});
