import { Tabs, Redirect } from 'expo-router';
import { Platform, View, ActivityIndicator } from 'react-native';
import { colors } from '@/theme/tokens';
import { useMeQuery } from '@/api/api';

export default function AssistantLayout() {
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

  const isAssistant = me.roles.includes('ASSISTANT');
  const isOwner = me.roles.includes('OWNER_ADMIN');
  const isDoctor = me.roles.includes('DOCTOR');

  if (!isAssistant && !isOwner) {
    if (isDoctor) {
      return <Redirect href="/doctor/today" />;
    }
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // @ts-expect-error
        unmountOnBlur: true,
        tabBarActiveTintColor: colors.primary,
        tabBarStyle: {
          paddingBottom: Platform.OS === 'ios' ? 20 : 0,
          height: Platform.OS === 'ios' ? 70 : 56,
          justifyContent: 'center',
        },
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: {
          fontSize: 14,
          fontWeight: '700',
          marginBottom: Platform.OS === 'android' ? 14 : 0,
        },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="appointments" options={{ title: 'Appointments' }} />
      <Tabs.Screen name="patients" options={{ title: 'Patients' }} />
      <Tabs.Screen name="followups" options={{ title: 'Follow-ups' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
      <Tabs.Screen name="payments" options={{ href: null }} />
      <Tabs.Screen name="reminders" options={{ href: null }} />
      <Tabs.Screen name="walk-in" options={{ href: null }} />
    </Tabs>
  );
}
