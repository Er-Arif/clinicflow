import { Tabs, Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme/tokens';
import { useMeQuery } from '@/api/api';

export default function AssistantLayout() {
  const { data: me, isLoading, isError } = useMeQuery();
  const insets = useSafeAreaInsets();

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
          // @ts-expect-error Expo Router typings for unmountOnBlur are sometimes strict
          unmountOnBlur: true,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarShowLabel: true,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            height: 64 + insets.bottom,
            paddingTop: 8,
            paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          },
          tabBarLabelStyle: {
            fontSize: 13,
            fontWeight: '600',
            textAlign: 'center',
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
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', zIndex: 999 }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </View>
  );
}
