import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { colors } from '@/theme/tokens';

export default function AssistantLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarStyle: {
          paddingBottom: Platform.OS === 'ios' ? 20 : 10,
          height: Platform.OS === 'ios' ? 70 : 60,
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
