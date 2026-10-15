import { ActivityIndicator, Text } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors } from '@/theme/tokens';

type QueryState = {
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  isFetchNextPageError: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => unknown;
  refetch: () => unknown;
};

export function WorklistControls({ query, count, emptyText }: {
  query: QueryState; count: number; emptyText: string;
}) {
  return <>
    {query.isFetching ? <ActivityIndicator accessibilityLabel="Loading records" /> : null}
    {query.isError ? <>
      <Text accessibilityRole="alert" style={{ color: colors.danger }}>
        {query.isFetchNextPageError ? 'Unable to load more records. Your loaded records are still shown.'
          : count ? 'Unable to refresh. Shown records may be out of date.' : 'Unable to load records.'}
      </Text>
      <AppButton label="Retry" tone="secondary" disabled={query.isFetching}
        onPress={() => { if (query.isFetchNextPageError) void query.fetchNextPage(); else void query.refetch(); }} />
    </> : query.isSuccess && !query.isFetching && count === 0 ? <Text style={{ color: colors.muted }}>{emptyText}</Text> : null}
    {!query.isError && query.hasNextPage ? <AppButton label="Load more" tone="secondary"
      disabled={query.isFetching} onPress={() => { void query.fetchNextPage(); }} /> : null}
  </>;
}
