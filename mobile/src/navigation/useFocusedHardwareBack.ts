import { useCallback, useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * Intercepts Android hardware Back only while the current route is focused.
 * Use this when native Back must follow an explicit in-app navigation rule
 * instead of blindly popping the current navigator history.
 */
export function useFocusedHardwareBack(onBack: () => void, enabled = true) {
  const onBackRef = useRef(onBack);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        onBackRef.current();
        return true;
      });

      return () => subscription.remove();
    }, [enabled]),
  );
}
