import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useFollowUpWorklistInfiniteQuery } from '@/api/api';
import { worklistItems } from '@/api/worklists';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { WorklistControls } from '@/components/WorklistControls';
import { colors, radius, spacing } from '@/theme/tokens';

const FILTERS = [
  ['DUE_TODAY', 'Due Today'],
  ['UPCOMING', 'Upcoming'],
  ['OVERDUE', 'Overdue'],
  ['BOOKED', 'Booked'],
] as const;

export default function FollowUpsScreen() {
  const router = useRouter();
  const [first] = FILTERS;
  const state = first[0];
  const due = useFollowUpWorklistInfiniteQuery({ state }, { refetchOnMountOrArgChange: true });
  const upcoming = useFollowUpWorklistInfiniteQuery({ state: 'UPCOMING' }, { refetchOnMountOrArgChange: true });
  const overdue = useFollowUpWorklistInfiniteQuery({ state: 'OVERDUE' }, { refetchOnMountOrArgChange: true });
  const booked = useFollowUpWorklistInfiniteQuery({ state: 'BOOKED' }, { refetchOnMountOrArgChange: true });
  const groups = [
    ['Due Today', due],
    ['Overdue', overdue],
    ['Upcoming', upcoming],
    ['Booked', booked],
  ] as const;

  return (
    <AppScreen refreshing={groups.some(([, query]) => query.isFetching && !query.isFetchingNextPage)}
      onRefresh={() => { for (const [, query] of groups) void query.refetch(); }}>
      <Text style={styles.title}>Follow-ups</Text>
      <Text style={styles.subtitle}>Recommendations are separate from appointments until they are booked.</Text>
      {groups.map(([title, query]) => {
        const items = worklistItems(query.currentData, item => item.followup_id);
        return (
          <View key={title} style={styles.section}>
            <Text style={styles.sectionTitle}>{title} · {items.length} of {query.currentData?.pages[0]?.total ?? '…'}</Text>
            {items.map((item) => (
              <View key={item.followup_id} style={styles.card}>
                <Text style={styles.patient}>{item.patient.full_name}</Text>
                <Text style={styles.subtitle}>Due {item.due_date} · {item.status}{item.overdue ? ' · OVERDUE' : ''}</Text>
                {item.linked_appointment ? <Text style={styles.subtitle}>Booked {item.linked_appointment.date} {item.linked_appointment.time?.slice(0, 5) ?? ''}</Text> : null}
                <AppButton label="Open" tone="secondary" onPress={() => router.push({ pathname: '/assistant/followups/[followupId]', params: { followupId: item.followup_id } })} />
              </View>
            ))}
            <WorklistControls query={query} count={items.length} emptyText="Nothing here." />
          </View>
        );
      })}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  section: { gap: spacing.sm, marginTop: spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  patient: { fontSize: 17, fontWeight: '800', color: colors.text },
});

