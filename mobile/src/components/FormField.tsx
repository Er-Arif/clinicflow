import type { RefObject } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { colors, radius, spacing } from '@/theme/tokens';

type Props = TextInputProps & {
  label: string;
  error?: string;
  inputRef?: RefObject<TextInput | null>;
};

export function FormField({ label, error, inputRef, ...props }: Props) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <KeyboardSafeTextInput
        ref={inputRef}
        {...props}
        style={[
          styles.input,
          props.multiline ? styles.multilineInput : null,
          error ? styles.inputError : null,
          props.style,
        ]}
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
  multilineInput: {
    textAlignVertical: 'top',
    verticalAlign: 'top',
    paddingTop: 10,
    paddingBottom: 10,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, fontSize: 13 },
});
