import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  PropsWithChildren,
} from 'react';
import {
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/tokens';

type ScrollContextValue = {
  scrollIntoView: (targetNode: any) => void;
};

export const ScrollContext = createContext<ScrollContextValue | null>(null);

export function useScrollIntoView() {
  return useContext(ScrollContext);
}

export function AppScreen({
  children,
  contentStyle,
  refreshing = false,
  onRefresh,
}: PropsWithChildren<{ contentStyle?: ViewStyle; refreshing?: boolean; onRefresh?: () => void }>) {
  const scrollViewRef = useRef<ScrollView>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const keyboardHeightRef = useRef(0);
  const activeNodeRef = useRef<any>(null);
  const scrollYRef = useRef(0);
  const scrollTimerRef = useRef<any>(null);

  const performScroll = useCallback(() => {
    const node = activeNodeRef.current;
    const sv = scrollViewRef.current;
    if (!node || !sv) return;

    try {
      if (typeof node.measureInWindow === 'function') {
        node.measureInWindow((_x: number, y: number, _width: number, height: number) => {
          if (isNaN(y) || (y === 0 && height === 0)) return;

          const windowHeight = Dimensions.get('window').height;
          const currentKeyboard = keyboardHeightRef.current;
          const keyboardTop = currentKeyboard > 0 ? windowHeight - currentKeyboard : windowHeight;
          const bottom = y + height;
          const bottomMargin = spacing.lg; // 24px clearance above keyboard

          if (bottom > keyboardTop - bottomMargin) {
            const overflow = bottom - (keyboardTop - bottomMargin);
            const targetY = scrollYRef.current + overflow;
            sv.scrollTo({ y: Math.max(0, targetY), animated: true });
          } else if (y < spacing.xl) {
            const underflow = spacing.xl - y;
            const targetY = scrollYRef.current - underflow;
            sv.scrollTo({ y: Math.max(0, targetY), animated: true });
          }
        });
      }
    } catch {
      // Safe fallback
    }
  }, []);

  const scheduleScroll = useCallback((delay = 80) => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
    }
    scrollTimerRef.current = setTimeout(() => {
      requestAnimationFrame(() => {
        performScroll();
      });
    }, delay);
  }, [performScroll]);

  const scrollIntoView = useCallback((targetNode: any) => {
    if (!targetNode) return;
    activeNodeRef.current = targetNode;
    if (keyboardHeightRef.current > 0) {
      scheduleScroll(50);
    }
  }, [scheduleScroll]);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        const height = e.endCoordinates.height;
        keyboardHeightRef.current = height;
        setKeyboardHeight(height);
        scheduleScroll(100);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        keyboardHeightRef.current = 0;
        setKeyboardHeight(0);
        activeNodeRef.current = null;
        if (scrollTimerRef.current) {
          clearTimeout(scrollTimerRef.current);
        }
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current);
      }
    };
  }, [scheduleScroll]);

  return (
    <ScrollContext.Provider value={{ scrollIntoView }}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            ref={scrollViewRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
              scrollYRef.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            contentContainerStyle={[
              styles.content,
              contentStyle,
              keyboardHeight > 0 && { paddingBottom: keyboardHeight + spacing.xl },
            ]}
            refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
});
