import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  PropsWithChildren,
} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
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
  const activeNodeRef = useRef<any>(null);

  const scrollIntoView = (targetNode: any) => {
    if (!targetNode || !scrollViewRef.current) return;
    activeNodeRef.current = targetNode;

    const executeScroll = () => {
      if (!scrollViewRef.current || !activeNodeRef.current) return;
      const sv = scrollViewRef.current as any;
      try {
        const innerNode = sv.getInnerViewNode?.() || sv;
        if (typeof activeNodeRef.current.measureLayout === 'function') {
          activeNodeRef.current.measureLayout(
            innerNode,
            (_x: number, y: number) => {
              sv.scrollTo?.({ y: Math.max(0, y - 60), animated: true });
            },
            () => {
              if (typeof sv.scrollResponderScrollNativeHandleToKeyboard === 'function') {
                sv.scrollResponderScrollNativeHandleToKeyboard(activeNodeRef.current, 80, true);
              }
            }
          );
        } else if (typeof sv.scrollResponderScrollNativeHandleToKeyboard === 'function') {
          sv.scrollResponderScrollNativeHandleToKeyboard(activeNodeRef.current, 80, true);
        }
      } catch {
        // Safe fallback
      }
    };

    setTimeout(executeScroll, 100);
  };

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
        if (activeNodeRef.current) {
          scrollIntoView(activeNodeRef.current);
        }
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
        activeNodeRef.current = null;
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
