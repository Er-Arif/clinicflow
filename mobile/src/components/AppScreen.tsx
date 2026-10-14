import type { PropsWithChildren } from 'react';
import { RefreshControl, ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/tokens';

// Read-only screens use this container. Editable forms opt in to KeyboardSafeFormScreen.
export function AppScreen({
  children,
  contentStyle,
  refreshing = false,
  onRefresh,
}: PropsWithChildren<{ contentStyle?: ViewStyle; refreshing?: boolean; onRefresh?: () => void }>) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.content, contentStyle]}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
});
