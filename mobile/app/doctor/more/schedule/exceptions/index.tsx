import { formatClinicDate } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  useClinicTimeQuery,
  useListDoctorsQuery,
  useListScheduleExceptionsQuery,
  useUnblockScheduleExceptionsMutation,
} from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

// BLOCKED is the API state; the staff-facing label is sentence-cased as “Blocked”.
export default function ExceptionsHubScreen() {
  const router = useRouter();
  const clinicTime = useClinicTimeQuery();
  const today = clinicTime.data?.clinic_date ?? '';
  const doctors = useListDoctorsQuery();
  const doctorId = doctors.data?.[0]?.doctor_id ?? '';

  const exceptionsQuery = useListScheduleExceptionsQuery(
    { doctorId, fromDate: today },
    { skip: !doctorId || !today }
  );

  const [unblockMutation, unblockState] = useUnblockScheduleExceptionsMutation();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const exceptions = exceptionsQuery.data?.exceptions ?? [];

  async function handleUnblock(itemKey: string, occurrenceIds: string[]) {
    if (!doctorId || occurrenceIds.length === 0) return;
    try {
      setUnblockingId(itemKey);
      setActionMessage(null);
      await unblockMutation({
        doctorId,
        body: { occurrence_ids: occurrenceIds },
      }).unwrap();
      setActionMessage('Exception unblocked successfully. Normal booking is restored.');
      void exceptionsQuery.refetch();
    } catch (error) {
      setActionMessage(apiError(error)?.message ?? 'Unable to unblock exception.');
    } finally {
      setUnblockingId(null);
    }
  }

  return (
    <AppScreen>
      <BackButton />
      <QueryState query={clinicTime} label="clinic date" />
      <QueryState query={doctors} label="doctors" />
      <QueryState query={exceptionsQuery} label="exceptions" />
      <View style={styles.header}>
        <Text style={styles.title}>Exceptions & time off</Text>
        <Text style={styles.subtitle}>
          Chronological list of all upcoming blocked dates and session-specific time off.
        </Text>
      </View>

      <AppButton
        label="+ Block a date"
        tone="primary"
        onPress={() => router.push('/doctor/more/schedule/exceptions/new')}
      />

      {actionMessage && (
        <View style={actionMessage.includes('successfully') ? styles.successBox : styles.errorBox}>
          <Text style={actionMessage.includes('successfully') ? styles.successText : styles.errorText}>
            {actionMessage}
          </Text>
        </View>
      )}

      {exceptionsQuery.isLoading ? (
        <Text style={styles.loadingText}>Loading exceptions...</Text>
      ) : !exceptionsQuery.data || (exceptionsQuery.isError && exceptions.length === 0) ? null : exceptions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No upcoming exceptions</Text>
          <Text style={styles.emptySubtitle}>
            No dates or sessions are currently blocked. Your recurring weekly schedule applies normally.
          </Text>
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          {exceptions.map((item) => {
            const isUnblockingThis = unblockState.isLoading && unblockingId === item.id;
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.dateText}>{formatClinicDate(item.date)}</Text>
                  <View style={styles.statusBadge}>
                    <Text style={styles.statusBadgeText}>Blocked</Text>
                  </View>
                </View>

                <View style={styles.badgeRow}>
                  <View style={styles.scopeBadge}>
                    <Text style={styles.scopeBadgeText}>
                      {item.scope === 'FULL_DAY'
                        ? 'Full day'
                        : `Session: ${item.session_name ?? 'Specific session'}`}
                    </Text>
                  </View>
                  {item.start_time && item.end_time && (
                    <Text style={styles.timeText}>
                      {item.start_time.slice(0, 5)} – {item.end_time.slice(0, 5)}
                    </Text>
                  )}
                </View>

                <View style={styles.reasonBox}>
                  <Text style={styles.reasonLabel}>Reason:</Text>
                  <Text style={styles.reasonText}>{item.reason}</Text>
                </View>

                {item.retained_appointments_count > 0 && (
                  <View style={styles.warningNotice}>
                    <Text style={styles.warningNoticeText}>
                      {item.retained_appointments_count}{' '}
                      {item.retained_appointments_count === 1 ? 'patient' : 'patients'} already booked.
                      Appointments remain valid.
                    </Text>
                  </View>
                )}

                <AppButton
                  label="Unblock"
                  tone="secondary"
                  loading={isUnblockingThis}
                  onPress={() => void handleUnblock(item.id, item.occurrence_ids)}
                />
              </View>
            );
          })}
        </View>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4 },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  loadingText: { color: colors.muted, paddingVertical: spacing.md },
  emptyCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.xs,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  emptySubtitle: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 18 },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText: { fontSize: 18, fontWeight: '800', color: colors.text },
  statusBadge: {
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  scopeBadge: {
    backgroundColor: colors.softPrimary,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  scopeBadgeText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
  timeText: { color: colors.muted, fontSize: 12 },
  reasonBox: { flexDirection: 'row', gap: spacing.xs },
  reasonLabel: { color: colors.muted, fontWeight: '600', fontSize: 13 },
  reasonText: { color: colors.text, fontWeight: '600', fontSize: 13, flex: 1 },
  warningNotice: {
    backgroundColor: colors.softWarning,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  warningNoticeText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  successBox: {
    backgroundColor: '#E8F5E9',
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  successText: { color: colors.success, fontWeight: '700', fontSize: 13 },
  errorBox: {
    backgroundColor: '#FFEBEE',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  errorText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
});
