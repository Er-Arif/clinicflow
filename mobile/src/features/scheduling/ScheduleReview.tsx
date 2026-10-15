import { Modal, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, spacing } from '@/theme/tokens';
import type { EditorState } from './weeklyEditor';
import { dateLabel, weekdays } from './weeklyEditor';

export function ScheduleReview({ review, applying, onEdit, onApply }: {
  review: NonNullable<EditorState['review']>; applying: boolean; onEdit: () => void; onApply: () => void;
}) {
  return (
    <Modal visible animationType="slide" onRequestClose={() => { if (!applying) onEdit(); }}>
      <View style={styles.page}>
        <AppScreen>
          <Text accessibilityRole="header" style={styles.title}>Review weekly hours</Text>
          <Text style={styles.text}>{review.payload.weekdays.map(day => weekdays[day]).join(', ')}</Text>
          <Text style={styles.heading}>{review.payload.sessions.length ? 'Working day' : 'Day off'}</Text>
          {review.payload.sessions.map(session => (
            <View key={session.display_order} style={styles.section}>
              <Text style={styles.heading}>{session.session_name}</Text>
              <Text style={styles.text}>{session.start_time.slice(0, 5)} – {session.end_time.slice(0, 5)}</Text>
              <Text style={styles.text}>{session.slot_interval_minutes} min slots · Capacity {session.maximum_capacity}</Text>
            </View>
          ))}
          <Text style={styles.heading}>When each change starts</Text>
          {review.result.impacts.map(impact => (
            <View key={impact.weekday} style={styles.section}>
              <Text style={styles.heading}>{impact.weekday_name} — {dateLabel(impact.applies_from)}</Text>
              <Text style={impact.conflict_detected ? styles.warning : styles.success}>
                {impact.conflict_detected ? 'Deferred to a safe date' : 'Ready to apply on this date'}
              </Text>
              <Text style={styles.text}>{impact.reason}</Text>
              {impact.existing_appointments_count > 0 ? <Text style={styles.warning}>
                {impact.existing_appointments_count} existing appointment(s) affected by the proposed hours.
              </Text> : null}
              {typeof impact.conflict_metadata?.conflicting_date === 'string' ? <Text style={styles.text}>
                Conflict on {dateLabel(impact.conflict_metadata.conflicting_date)}.
              </Text> : null}
            </View>
          ))}
          <Text style={styles.text}>Existing appointments will be preserved. Review every date above before applying.</Text>
        </AppScreen>
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <AppButton label="Apply schedule" loading={applying} onPress={onApply} />
          <AppButton label="Continue editing" tone="secondary" disabled={applying} onPress={onEdit} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  heading: { fontSize: 16, fontWeight: '600', color: colors.text },
  text: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  section: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.border },
  warning: { color: colors.warning, fontSize: 14 },
  success: { color: colors.success, fontSize: 14 },
  footer: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface },
});
