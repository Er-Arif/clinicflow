import { Stack, Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useMeQuery } from '@/api/api';
import { colors, layout } from '@/theme/tokens';

export default function DoctorLayout() {
  const { data: me, isLoading, isError } = useMeQuery();

  if (isError) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!isLoading && me) {
    const isDoctor = me.roles.includes('DOCTOR');
    const isOwner = me.roles.includes('OWNER_ADMIN');
    const isAssistant = me.roles.includes('ASSISTANT');

    if (!isDoctor && !isOwner) {
      if (isAssistant) {
        return <Redirect href="/assistant/home" />;
      }
      return <Redirect href="/(auth)/login" />;
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      {isLoading && (
        <View style={{
          ...layout.absoluteFill,
          backgroundColor: colors.background,
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 999,
        }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </View>
  );
}
