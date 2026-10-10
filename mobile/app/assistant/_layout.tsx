import { Tabs, Redirect } from 'expo-router';
import { Platform, View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '@/theme/tokens';
import { useMeQuery } from '@/api/api';

export default function AssistantLayout() {
  const { data: me, isLoading, isError } = useMeQuery();

  if (isError || (!isLoading && !me)) {
    return <Redirect href="/(auth)/login" />;
  }

  const isAssistant = me?.roles.includes('ASSISTANT');
  const isOwner = me?.roles.includes('OWNER_ADMIN');
  const isDoctor = me?.roles.includes('DOCTOR');

  if (!isLoading && me && !isAssistant && !isOwner) {
    if (isDoctor) {
      return <Redirect href="/doctor/today" />;
    }
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          unmountOnBlur: true,
          tabBarActiveTintColor: colors.primary,
          tabBarIcon: () => null,
          tabBarStyle: {
            paddingBottom: Platform.OS === 'ios' ? 20 : 0,
            height: Platform.OS === 'ios' ? 70 : 56,
            justifyContent: 'center',
          },
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
      {isLoading && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </View>
  );
}
