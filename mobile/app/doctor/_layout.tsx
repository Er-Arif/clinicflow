import { Tabs, Redirect, useRouter, usePathname } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme/tokens';
import { useMeQuery } from '@/api/api';
import { isDoctorOrOwner, isAssistantRole } from '@/auth/session';
import { getSharedTabScreenOptions, TabIcon } from '@/navigation/tabOptions';

export default function DoctorLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me, isLoading, isError } = useMeQuery();
  const insets = useSafeAreaInsets();

  if (isError || (!isLoading && !me)) {
    return <Redirect href="/(auth)/login" />;
  }

  // Role shell precedence: Only Doctor/Owner can enter Doctor shell
  if (!isLoading && me) {
    if (!isDoctorOrOwner(me.roles)) {
      if (isAssistantRole(me.roles)) {
        return <Redirect href="/assistant/home" />;
      }
      return <Redirect href="/(auth)/login" />;
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={getSharedTabScreenOptions(insets)}>
        <Tabs.Screen
          name="today"
          options={{
            title: 'Today',
            tabBarIcon: ({ color, size }) => <TabIcon name="today" color={color} size={size} />,
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
          name="dashboard"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color, size }) => <TabIcon name="dashboard" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="reports"
          options={{
            title: 'Reports',
            tabBarIcon: ({ color, size }) => <TabIcon name="reports" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="more"
          listeners={{
            tabPress: (e) => {
              if (pathname.startsWith('/doctor/settings') || pathname === '/(auth)/change-password') {
                e.preventDefault();
                if (router.canDismiss()) {
                  router.dismissTo('/doctor/more');
                } else {
                  router.navigate('/doctor/more');
                }
              }
            },
          }}
          options={{
            title: 'More',
            tabBarIcon: ({ color, size }) => <TabIcon name="more" color={color} size={size} />,
          }}
        />
        <Tabs.Screen name="settings" options={{ href: null }} />
      </Tabs>
      {isLoading && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', zIndex: 999 }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </View>
  );
}
