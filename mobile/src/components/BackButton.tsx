import React from 'react';
import { Pressable, StyleSheet, Text, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing } from '@/theme/tokens';

interface BackButtonProps {
  label?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function BackButton({ label = 'Back', onPress, style, textStyle }: BackButtonProps) {
  const router = useRouter();

  return (
    <Pressable
      onPress={onPress ?? (() => router.back())}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={[styles.button, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.text, textStyle]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    marginBottom: spacing.xs,
  },
  text: {
    color: colors.primary,
    fontWeight: '800',
    fontSize: 16,
  },
});
