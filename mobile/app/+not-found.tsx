import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, spacing } from '@/theme/tokens';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <AppScreen contentStyle={styles.content}>
      <Text style={styles.title}>This ClinicFlow link is not available</Text>
      <Text style={styles.body}>
        The link may be old, incomplete, or not valid for your account. No clinic data was changed.
      </Text>
      <AppButton label="Return to ClinicFlow" onPress={() => router.replace('/')} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'center', gap: spacing.lg },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24 },
});
