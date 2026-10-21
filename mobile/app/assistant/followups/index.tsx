import { formatClinicDate, formatClinicTime } from '@/utils/dates';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useFollowUpWorklistInfiniteQuery } from '@/api/api';
import { worklistItems } from '@/api/worklists';
import { AppScreen } from '@/components/AppScreen';
import { WorklistControls } from '@/components/WorklistControls';
import { colors, radius, spacing } from '@/theme/tokens';

export default function FollowUpsScreen() {
  const router = useRouter();
  const due = useFollowUpWorklistInfiniteQuery({ state: 'DUE_TODAY' }, { refetchOnMountOrArgChange: true });
  const upcoming = useFollowUpWorklistInfiniteQuery({ state: 'UPCOMING' }, { refetchOnMountOrArgChange: true });
  const overdue = useFollowUpWorklistInfiniteQuery({ state: 'OVERDUE' }, { refetchOnMountOrArgChange: true });
  const booked = useFollowUpWorklistInfiniteQuery({ state: 'BOOKED' }, { refetchOnMountOrArgChange: true });
  const groups = [
    ['Due today', due],
    ['Overdue', overdue],
    ['Upcoming', upcoming],
    ['Booked', booked],
  ] as const;
  const settled = groups.every(([, query]) => query.isSuccess || query.isError);
  const anyItems = groups.some(([, query]) => worklistItems(query.currentData, item => item.followup_id).length > 0);

  return (
    <AppScreen refreshing={groups.some(([, query]) => query.isFetching && !query.isFetchingNextPage)}
      onRefresh={() => { for (const [, query] of groups) void query.refetch(); }}>
      <View style={styles.header}>
        <Text style={styles.title}>Follow-ups</Text>
        <Text style={styles.subtitle}>Recommendations and booked follow-up visits</Text>
      </View>

      <View style={styles.summaryGrid}>
        {groups.map(([title, query]) => {
          const total = query.currentData?.pages[0]?.total;
          return (
            <View key={title} style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{title}</Text>
              <Text style={styles.summaryCount}>{total ?? (query.isError ? '—' : '…')}</Text>
            </View>
          );
        })}
      </View>

      {groups.map(([title, query]) => {
        const items = worklistItems(query.currentData, item => item.followup_id);
        if (items.length === 0 && !query.isError) return null;
        return (
          <View key={title} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{title}</Text>
              {items.length > 0 ? <Text style={styles.sectionCount}>{items.length}</Text> : null}
            </View>
            {items.map((item) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open follow-up for ${item.patient.full_name}`}
                key={item.followup_id}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                onPress={() => router.push({ pathname: '/assistant/followups/[followupId]', params: { followupId: item.followup_id } })}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.patient}>{item.patient.full_name}</Text>
                  <View style={[
                    styles.statusPill,
                    title === 'Booked' && styles.statusBooked,
                    title === 'Overdue' && styles.statusOverdue,
                    title === 'Due today' && styles.statusDue,
                  ]}>
                    <Text style={[
                      styles.statusText,
                      title === 'Booked' && styles.statusBookedText,
                      title === 'Overdue' && styles.statusOverdueText,
                      title === 'Due today' && styles.statusDueText,
                    ]}>{title}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>Due {formatClinicDate(item.due_date)}</Text>
                {item.linked_appointment ? (
                  <Text style={styles.appointmentMeta}>
                    Appointment · {formatClinicDate(item.linked_appointment.date)}{item.linked_appointment.time ? ` · ${formatClinicTime(item.linked_appointment.time)}` : ''}
                  </Text>
                ) : null}
                <Text style={styles.viewDetails}>View details ›</Text>
              </Pressable>
            ))}
            <WorklistControls query={query} count={items.length} emptyText="" />
          </View>
        );
      })}

      {settled && !anyItems && !groups.some(([, query]) => query.isError) ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No follow-ups to show</Text>
          <Text style={styles.subtitle}>New recommendations will appear here after visits are completed.</Text>
        </View>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 3 },
  title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, lineHeight: 19, fontSize: 13 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryCard: { flexGrow: 1, flexBasis: '46%', minWidth: 130, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13, gap: 2 },
  summaryLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  summaryCount: { color: colors.primaryDark, fontSize: 22, fontWeight: '800' },
  section: { gap: spacing.sm, marginTop: spacing.xs },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sectionCount: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  pressed: { opacity: 0.78 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  patient: { flex: 1, fontSize: 17, fontWeight: '800', color: colors.text },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  appointmentMeta: { color: colors.primaryDark, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  statusPill: { backgroundColor: colors.softPrimary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { color: colors.primary, fontWeight: '700', fontSize: 11 },
  statusBooked: { backgroundColor: colors.softSuccess },
  statusBookedText: { color: colors.success },
  statusOverdue: { backgroundColor: colors.softDanger },
  statusOverdueText: { color: colors.danger },
  statusDue: { backgroundColor: colors.softWarning },
  statusDueText: { color: colors.warning },
  viewDetails: { color: colors.primary, fontSize: 13, fontWeight: '800', marginTop: 2 },
  emptyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
});
