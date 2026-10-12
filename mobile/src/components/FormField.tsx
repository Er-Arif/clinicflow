import { useRef } from 'react';
import {
  NativeSyntheticEvent,
  StyleSheet,
  TargetedEvent,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

import { useScrollIntoView } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

type Props = TextInputProps & {
  label: string;
  error?: string;
};

export function FormField({ label, error, onFocus, ...props }: Props) {
  const containerRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);
  const scrollContext = useScrollIntoView();

  const handleFocus = (e: NativeSyntheticEvent<TargetedEvent>) => {
    onFocus?.(e as any);
    if (containerRef.current) {
      scrollContext?.scrollIntoView(containerRef.current);
    } else if (inputRef.current) {
      scrollContext?.scrollIntoView(inputRef.current);
    }
  };

  return (
    <View ref={containerRef} style={styles.wrapper} collapsable={false}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        {...props}
        onFocus={handleFocus}
        style={[styles.input, error ? styles.inputError : null, props.style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  label: { fontSize: 14, fontWeight: '600', color: colors.text },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
});
