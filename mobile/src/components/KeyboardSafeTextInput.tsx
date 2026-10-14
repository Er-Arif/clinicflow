import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { Keyboard, StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { useFormKeyboard } from '@/components/keyboard/FormKeyboardContext';

// No presentation defaults: existing raw inputs retain their styles and props.
export const KeyboardSafeTextInput = forwardRef<TextInput, TextInputProps>(function KeyboardSafeTextInput(
  { onFocus, onBlur, onLayout, onContentSizeChange, onSelectionChange, style, ...props }, ref,
) {
  const inputRef = useRef<TextInput>(null);
  const context = useFormKeyboard();
  const visibility = context?.visibility;
  const setInputRef = useCallback((input: TextInput | null) => {
    if (inputRef.current && inputRef.current !== input) visibility?.blur(inputRef.current);
    inputRef.current = input;
  }, [visibility]);
  useImperativeHandle(ref, () => inputRef.current!, []);

  const inputChanged = () => {
    if (inputRef.current) visibility?.inputChanged(inputRef.current);
  };
  const viewportHeight = context?.viewportHeight ?? 0;
  const existingMaxHeight = StyleSheet.flatten(style)?.maxHeight;
  // Long templates must scroll internally once they fill the available viewport.
  // Smaller explicit caps (such as Reason's 110px cap) are preserved.
  const multilineLimit = props.multiline && viewportHeight > 0
    ? { maxHeight: Math.min(viewportHeight, typeof existingMaxHeight === 'number' ? existingMaxHeight : Infinity) }
    : undefined;

  return (
    <TextInput
      {...props}
      ref={setInputRef}
      style={[style, multilineLimit]}
      onFocus={(event) => {
        onFocus?.(event);
        if (inputRef.current) visibility?.focus(inputRef.current, Keyboard.metrics()?.screenY ?? Infinity);
      }}
      onBlur={(event) => {
        if (inputRef.current) visibility?.blur(inputRef.current);
        onBlur?.(event);
      }}
      onLayout={(event) => { onLayout?.(event); inputChanged(); }}
      onContentSizeChange={(event) => { onContentSizeChange?.(event); inputChanged(); }}
      onSelectionChange={(event) => { onSelectionChange?.(event); inputChanged(); }}
    />
  );
});
