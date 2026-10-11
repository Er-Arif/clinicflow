import { Tabs, Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme/tokens';
import { useMeQuery } from '@/api/api';
import { getSharedTabScreenOptions, TabIcon } from '@/navigation/tabOptions';

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
      <Tabs screenOptions={getSharedTabScreenOptions(insets)}>
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <TabIcon name="home" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="appointments"
          options={{
            title: 'Appointments',
            tabBarLabel: 'Appts',
            tabBarIcon: ({ color, size }) => <TabIcon name="appointments" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="patients"
          options={{
            title: 'Patients',
            tabBarIcon: ({ color, size }) => <TabIcon name="patients" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="followups"
          options={{
            title: 'Follow-ups',
            tabBarIcon: ({ color, size }) => <TabIcon name="followups" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: 'More',
            tabBarIcon: ({ color, size }) => <TabIcon name="more" color={color} size={size} />,
          }}
        />
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
