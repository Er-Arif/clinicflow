import { Stack, Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useMeQuery } from '@/api/api';
import { colors } from '@/theme/tokens';

export default function DoctorLayout() {
  const { data: me, isLoading, isError } = useMeQuery();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (isError || !me) {
    return <Redirect href="/(auth)/login" />;
  }

  const isDoctor = me.roles.includes('DOCTOR');
  const isOwner = me.roles.includes('OWNER_ADMIN');
  const isAssistant = me.roles.includes('ASSISTANT');

  if (!isDoctor && !isOwner) {
    if (isAssistant) {
      return <Redirect href="/assistant/home" />;
    }
    return <Redirect href="/(auth)/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
