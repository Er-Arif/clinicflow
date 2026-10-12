import { Stack } from 'expo-router';

export default function ScheduleLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="weekly/index" />
      <Stack.Screen name="exceptions/index" />
      <Stack.Screen name="exceptions/new" />
    </Stack>
  );
}
