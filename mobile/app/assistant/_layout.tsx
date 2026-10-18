import { Tabs, Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme/tokens';
import { useMeQuery } from '@/api/api';
import { isDoctorOrOwner, isAssistantRole } from '@/auth/session';
import { getSharedTabScreenOptions, TabIcon } from '@/navigation/tabOptions';

export default function AssistantLayout() {
  const { data: me, isLoading, isError } = useMeQuery();
  const insets = useSafeAreaInsets();

  if (isError || (!isLoading && !me)) {
    return <Redirect href="/(auth)/login" />;
  }

  // Role shell precedence: Doctor/Owner wins even if ASSISTANT is present
  if (!isLoading && me) {
    if (isDoctorOrOwner(me.roles)) {
      return <Redirect href="/doctor/today" />;
    }
    if (!isAssistantRole(me.roles)) {
      return <Redirect href="/(auth)/login" />;
    }
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
            tabBarLabel: ({ color }) => (
              <Text allowFontScaling={false} numberOfLines={1} style={[styles.appointmentsTabLabel, { color }]}>Appointments</Text>
            ),
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

const styles = StyleSheet.create({
  appointmentsTabLabel: {
    width: 76,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '600',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
