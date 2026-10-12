import React from 'react';
import type { ColorValue } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect, Circle, Line } from 'react-native-svg';
import { colors } from '@/theme/tokens';

export type TabIconName =
  | 'home'
  | 'appointments'
  | 'today'
  | 'patients'
  | 'followups'
  | 'dashboard'
  | 'reports'
  | 'more';

export function TabIcon({ name, color, size = 20 }: { name: TabIconName; color?: ColorValue; size?: number }) {
  switch (name) {
    case 'home':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <Path d="M9 22V12h6v10" />
        </Svg>
      );
    case 'appointments':
    case 'today':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <Line x1="16" y1="2" x2="16" y2="6" />
          <Line x1="8" y1="2" x2="8" y2="6" />
          <Line x1="3" y1="10" x2="21" y2="10" />
        </Svg>
      );
    case 'patients':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <Circle cx="9" cy="7" r="4" />
          <Path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </Svg>
      );
    case 'followups':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M1 4v6h6" />
          <Path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </Svg>
      );
    case 'dashboard':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Rect x="3" y="3" width="7" height="7" />
          <Rect x="14" y="3" width="7" height="7" />
          <Rect x="14" y="14" width="7" height="7" />
          <Rect x="3" y="14" width="7" height="7" />
        </Svg>
      );
    case 'reports':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <Path d="M14 2v6h6" />
          <Line x1="16" y1="13" x2="8" y2="13" />
          <Line x1="16" y1="17" x2="8" y2="17" />
          <Line x1="10" y1="9" x2="8" y2="9" />
        </Svg>
      );
    case 'more':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
          <Circle cx="12" cy="12" r="2" />
          <Circle cx="19" cy="12" r="2" />
          <Circle cx="5" cy="12" r="2" />
        </Svg>
      );
  }
}

export function getSharedTabScreenOptions(insets: EdgeInsets) {
  return {
    headerShown: false,
    unmountOnBlur: true,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.muted,
    tabBarShowLabel: true,
    tabBarHideOnKeyboard: true,
    tabBarStyle: {
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      height: 62 + insets.bottom,
      paddingTop: 6,
      paddingBottom: insets.bottom > 0 ? insets.bottom : 6,
    },
    tabBarLabelStyle: {
      fontSize: 11,
      fontWeight: '600' as const,
      textAlign: 'center' as const,
    },
    tabBarIconStyle: {
      marginBottom: 2,
    },
  };
}
