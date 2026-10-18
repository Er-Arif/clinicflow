import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate, formatClinicTimeRange } from '@/utils/dates';
import type { EditorState } from './weeklyEditor';
import { calculatedSlots, dateLabel, weekdays } from './weeklyEditor';

export function ScheduleReview({ review, applying, onEdit, onApply }: {
  review: NonNullable<EditorState['review']>;
  applying: boolean;
  onEdit: () => void;
  onApply: () => void;
}) {
  return (
    <Modal visible animationType="slide" onRequestClose={() => { if (!applying) onEdit(); }}>
      <View style={styles.page}>
        <AppScreen>
          <Text accessibilityRole="header" style={styles.title}>Review weekly hours</Text>
          <Text style={styles.text}>{review.payload.weekdays.map(day => weekdays[day]).join(', ')}</Text>
          <Text style={styles.heading}>{review.payload.sessions.length ? 'Working day' : 'Day off'}</Text>
          {review.payload.sessions.map(session => {
            const slots = calculatedSlots(session.start_time, session.end_time, String(session.slot_interval_minutes));
            const hasLowerLimit = slots != null && session.maximum_capacity < slots;
            return (
              <View key={session.display_order} style={styles.sessionCard}>
                <Text style={styles.heading}>{session.session_name}</Text>
                <Text style={styles.time}>{formatClinicTimeRange(session.start_time, session.end_time)}</Text>
                <Text style={styles.text}>
                  {session.slot_interval_minutes} min slots
                  {slots != null ? ` · ${slots} available` : ''}
                  {hasLowerLimit ? ` · Booking limit ${session.maximum_capacity}` : ` · Capacity ${session.maximum_capacity}`}
                </Text>
              </View>
            );
          })}
          <Text style={styles.sectionTitle}>Effective dates</Text>
          {review.result.impacts.map(impact => (
            <View key={impact.weekday} style={styles.section}>
              <View style={styles.impactRow}>
                <Text style={styles.heading}>{impact.weekday_name}</Text>
                <Text style={styles.date}>{dateLabel(impact.applies_from)}</Text>
              </View>
              <Text style={impact.conflict_detected ? styles.warning : styles.success}>{impact.conflict_detected ? 'Deferred to a safe date' : 'Ready to apply'}</Text>
              {impact.existing_appointments_count > 0 ? (
                <Text style={styles.warning}>
                  {impact.existing_appointments_count} existing appointment(s) preserved{impact.conflict_metadata?.conflicting_date ? ` from ${formatClinicDate(String(impact.conflict_metadata.conflicting_date))}` : ''}.
                </Text>
              ) : null}
            </View>
          ))}
        </AppScreen>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <AppButton label="Apply schedule" loading={applying} onPress={onApply} />
          <AppButton compact label="Continue editing" tone="secondary" disabled={applying} onPress={onEdit} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.primaryDark, marginTop: spacing.xs },
  heading: { fontSize: 15, fontWeight: '700', color: colors.text },
  text: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  time: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
  sessionCard: { gap: 3, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  section: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.border },
  impactRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  date: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  warning: { color: colors.warning, fontSize: 13 },
  success: { color: colors.success, fontSize: 13, fontWeight: '700' },
  footer: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
