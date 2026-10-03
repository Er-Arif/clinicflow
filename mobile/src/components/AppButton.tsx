import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius } from '@/theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
};

export function AppButton({ label, onPress, disabled, loading, tone = 'primary' }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'secondary' && styles.secondary,
        tone === 'danger' && styles.danger,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tone === 'secondary' ? colors.primary : '#FFFFFF'} />
      ) : (
        <Text style={[styles.label, tone === 'secondary' && styles.secondaryLabel]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: 18,
    backgroundColor: colors.primary,
  },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
  danger: { backgroundColor: colors.danger },
  label: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  secondaryLabel: { color: colors.primary },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.82 },
});
