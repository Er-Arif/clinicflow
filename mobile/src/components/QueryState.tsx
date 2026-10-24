import { ActivityIndicator, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors, spacing } from '@/theme/tokens';

type ReadState = { isFetching?: boolean; isLoading?: boolean; isError?: boolean; isSuccess?: boolean; data?: unknown; refetch: () => unknown };

export function QueryState({ query, label, empty, hasData = query.data !== undefined }: {
  query: ReadState; label: string; empty?: string; hasData?: boolean;
}) {
  const loading = query.isFetching || query.isLoading;
  const showEmpty = query.isSuccess && !loading && !query.isError && Boolean(empty);
  if (!loading && !query.isError && !showEmpty) return null;

  return <View style={{ gap: spacing.sm }}>
    {loading ? <ActivityIndicator accessibilityLabel={`Loading ${label}`} color={colors.primary} /> : null}
    {query.isError ? <>
      <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>
        {hasData ? `${label} may be out of date.` : `Unable to load ${label}.`}
      </Text>
      <AppButton compact label={`Retry ${label}`} tone="secondary" disabled={query.isFetching} onPress={() => { void query.refetch(); }} />
    </> : showEmpty ? <Text style={{ color: colors.muted, fontSize: 13 }}>{empty}</Text> : null}
  </View>;
}
