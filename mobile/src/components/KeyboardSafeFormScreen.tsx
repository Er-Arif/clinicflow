import { useCallback, useEffect, useMemo, useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormKeyboardContext } from '@/components/keyboard/FormKeyboardContext';
import { createKeyboardVisibility } from '@/components/keyboard/visibility';
import { colors, spacing } from '@/theme/tokens';

type Props = PropsWithChildren<{
  contentStyle?: StyleProp<ViewStyle>;
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}>;

export function KeyboardSafeFormScreen({ children, contentStyle, footer, refreshing = false, onRefresh }: Props) {
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [visibility] = useState(() => createKeyboardVisibility({
    android: Platform.OS === 'android',
    setInset: setKeyboardInset,
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (frame) => cancelAnimationFrame(frame),
  }));
  const context = useMemo(() => ({ visibility, viewportHeight }), [visibility, viewportHeight]);
  const attachViewport = useCallback((node: View | null) => visibility.setViewport(node), [visibility]);
  const attachScrollViewport = useCallback((node: ScrollView | null) => visibility.setScrollViewport(node), [visibility]);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => visibility.setKeyboardTop(event.endCoordinates.screenY),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => visibility.setKeyboardTop(Infinity),
    );
    visibility.setKeyboardTop(Keyboard.metrics()?.screenY ?? Infinity);
    return () => {
      showSub.remove();
      hideSub.remove();
      visibility.cancelPending();
    };
  }, [visibility]);

  return (
    <FormKeyboardContext.Provider value={context}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <View
            ref={attachViewport}
            collapsable={false}
            style={[styles.flex, { paddingBottom: keyboardInset }]}
            onLayout={visibility.schedule}
          >
            <ScrollView
              ref={attachScrollViewport}
              style={styles.flex}
              contentContainerStyle={[styles.content, contentStyle]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onLayout={(event) => {
                setViewportHeight(event.nativeEvent.layout.height);
                visibility.schedule();
              }}
              onContentSizeChange={visibility.schedule}
              onScroll={(event) => visibility.setScrollY(event.nativeEvent.contentOffset.y)}
              scrollEventThrottle={16}
              refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
            >
              {children}
            </ScrollView>
            {footer}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </FormKeyboardContext.Provider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
});
