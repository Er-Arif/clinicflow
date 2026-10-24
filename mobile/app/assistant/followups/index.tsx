import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useFollowUpWorklistInfiniteQuery } from '@/api/api';
import { worklistItems } from '@/api/worklists';
import { AppScreen } from '@/components/AppScreen';
import { WorklistControls } from '@/components/WorklistControls';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate, formatClinicTime } from '@/utils/dates';

type FollowUpState = 'DUE_TODAY' | 'OVERDUE' | 'UPCOMING' | 'BOOKED';

export default function FollowUpsScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<FollowUpState | null>(null);
  const due = useFollowUpWorklistInfiniteQuery({ state: 'DUE_TODAY' }, { refetchOnMountOrArgChange: true });
  const overdue = useFollowUpWorklistInfiniteQuery({ state: 'OVERDUE' }, { refetchOnMountOrArgChange: true });
  const upcoming = useFollowUpWorklistInfiniteQuery({ state: 'UPCOMING' }, { refetchOnMountOrArgChange: true });
  const booked = useFollowUpWorklistInfiniteQuery({ state: 'BOOKED' }, { refetchOnMountOrArgChange: true });

  const groups = [
    ['DUE_TODAY', 'Due today', due],
    ['OVERDUE', 'Overdue', overdue],
    ['UPCOMING', 'Upcoming', upcoming],
    ['BOOKED', 'Booked', booked],
  ] as const;

  const totalFor = (query: typeof due) => query.currentData?.pages[0]?.total ?? 0;
  const preferredState: FollowUpState = totalFor(overdue) > 0
    ? 'OVERDUE'
    : totalFor(due) > 0
      ? 'DUE_TODAY'
      : totalFor(upcoming) > 0
        ? 'UPCOMING'
        : totalFor(booked) > 0
          ? 'BOOKED'
          : 'DUE_TODAY';
  const activeState = selected ?? preferredState;
  const activeGroup = groups.find(([state]) => state === activeState) ?? groups[0];
  const [, activeLabel, activeQuery] = activeGroup;
  const items = worklistItems(activeQuery.currentData, item => item.followup_id);

  return (
    <AppScreen
      refreshing={groups.some(([, , query]) => query.isFetching && !query.isFetchingNextPage)}
      onRefresh={() => { for (const [, , query] of groups) void query.refetch(); }}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Follow-up</Text>
        <Text style={styles.subtitle}>Work queue for recommended and booked follow-up visits</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
        accessibilityRole="tablist"
      >
        {groups.map(([state, label, query]) => {
          const active = activeState === state;
          const total = query.currentData?.pages[0]?.total;
          return (
            <Pressable
              key={state}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label} follow-ups${typeof total === 'number' ? `, ${total}` : ''}`}
              onPress={() => setSelected(state)}
              style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && styles.pressed]}
            >
              <Text style={[styles.filterLabel, active && styles.filterLabelActive]}>{label}</Text>
              <Text style={[styles.filterCountText, active && styles.filterCountTextActive]}>
                {total ?? (query.isError ? '!' : '…')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.queueHeader}>
        <Text style={styles.queueTitle}>{activeLabel}</Text>
      </View>

      <View style={styles.list}>
        {items.map(item => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open follow-up for ${item.patient.full_name}`}
            key={item.followup_id}
            style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}
            onPress={() => router.push({ pathname: '/assistant/followups/[followupId]', params: { followupId: item.followup_id } })}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.patient}>{item.patient.full_name}</Text>
              <Text style={styles.meta}>Due {formatClinicDate(item.due_date)}</Text>
              {item.linked_appointment ? (
                <Text style={styles.appointmentMeta}>
                  Booked for {formatClinicDate(item.linked_appointment.date)}{item.linked_appointment.time ? ` · ${formatClinicTime(item.linked_appointment.time)}` : ''}
                </Text>
              ) : null}
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>

      <WorklistControls
        query={activeQuery}
        count={items.length}
        emptyText={`No ${activeLabel.toLowerCase()} follow-ups.`}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 3 },
  title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, lineHeight: 19, fontSize: 13 },
  filterBar: { flexDirection: 'row', gap: spacing.xs, paddingRight: spacing.md },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 999, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 8 },
  filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterLabel: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  filterLabelActive: { color: '#FFFFFF' },
  filterCountText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  filterCountTextActive: { color: '#FFFFFF' },
  queueHeader: { marginTop: spacing.xs },
  queueTitle: { color: colors.primaryDark, fontSize: 18, fontWeight: '800' },
  list: { gap: spacing.sm },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: 14 },
  rowCopy: { flex: 1, gap: 3 },
  patient: { color: colors.text, fontSize: 16, fontWeight: '800' },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  appointmentMeta: { color: colors.primaryDark, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  chevron: { color: colors.primary, fontSize: 25, fontWeight: '500', paddingLeft: spacing.xs },
  pressed: { opacity: 0.78 },
});
