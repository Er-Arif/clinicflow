import { ActivityIndicator, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors, spacing } from '@/theme/tokens';

type ReadState = { isFetching?: boolean; isLoading?: boolean; isError?: boolean; isSuccess?: boolean; data?: unknown; refetch: () => unknown };

// Small presentation helper: the query continues to own fetching and retained data.
export function QueryState({ query, label, empty, hasData = query.data !== undefined }: {
  query: ReadState; label: string; empty?: string; hasData?: boolean;
}) {
  const loading = query.isFetching || query.isLoading;
  const showEmpty = query.isSuccess && !loading && !query.isError && Boolean(empty);
  if (!loading && !query.isError && !showEmpty) return null;
  return <View style={{ gap: spacing.sm }}>
    {loading ? <ActivityIndicator accessibilityLabel={`Loading ${label}`} color={colors.primary} /> : null}
    {query.isError ? <>
      <Text accessibilityRole="alert" style={{ color: colors.danger }}>
        {`Unable to load ${label}.${hasData ? ' Shown data may be out of date.' : ''}`}
      </Text>
      <AppButton label={`Retry ${label}`} tone="secondary" disabled={query.isFetching}
        onPress={() => { void query.refetch(); }} />
    </> : showEmpty ? <Text style={{ color: colors.muted }}>{empty}</Text> : null}
  </View>;
}
