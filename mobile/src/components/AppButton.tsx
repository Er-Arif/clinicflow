import type { StyleProp, ViewStyle } from 'react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius } from '@/theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({ label, onPress, disabled, loading, tone = 'primary', compact = false, style }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        tone === 'secondary' && styles.secondary,
        tone === 'danger' && styles.danger,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tone === 'primary' ? colors.surface : tone === 'danger' ? colors.danger : colors.primary} />
      ) : (
        <Text style={[
          styles.label,
          tone === 'secondary' && styles.secondaryLabel,
          tone === 'danger' && styles.dangerLabel,
          compact && styles.compactLabel,
        ]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: 17,
    paddingVertical: 11,
    backgroundColor: colors.primary,
  },
  compact: { minHeight: 40, paddingHorizontal: 14, paddingVertical: 8 },
  secondary: { backgroundColor: colors.softPrimary, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.softDanger, borderWidth: 1, borderColor: '#F0C5C5' },
  label: { color: colors.surface, fontWeight: '700', fontSize: 15 },
  compactLabel: { fontSize: 14 },
  secondaryLabel: { color: colors.primaryDark },
  dangerLabel: { color: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
});
