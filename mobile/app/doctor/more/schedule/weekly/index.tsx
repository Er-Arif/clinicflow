import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  useClinicTimeQuery,
  useGetScheduleQuery,
  useListDoctorsQuery,
} from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

const weekdayNames = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

export default function WeeklyScheduleIndexScreen() {
  const clinicTime = useClinicTimeQuery();
  const today = clinicTime.data?.clinic_date ?? '';
  const doctors = useListDoctorsQuery();
  const [selectedDoctor] = useState<string | null>(null);
  const doctorId = selectedDoctor ?? doctors.data?.[0]?.doctor_id ?? '';

  const scheduleQuery = useGetScheduleQuery(
    { doctorId, effectiveOn: today },
    { skip: !doctorId }
  );

  const days = scheduleQuery.data?.days ?? [];

  return (
    <AppScreen>
      <BackButton />
      <View style={styles.header}>
        <Text style={styles.title}>Weekly Working Hours</Text>
        <Text style={styles.subtitle}>
          Current active recurring weekly schedule across all days.
        </Text>
      </View>

      {/* Phase notice banner */}
      <View style={styles.noticeBanner}>
        <Text style={styles.noticeTitle}>Upcoming Phase 3 Feature</Text>
        <Text style={styles.noticeText}>
          Weekly hours editor will be updated in the next phase. Existing schedule definitions remain safely active.
        </Text>
      </View>

      {scheduleQuery.isLoading ? (
        <Text style={styles.loadingText}>Loading weekly hours...</Text>
      ) : days.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No weekly schedule configured.</Text>
        </View>
      ) : (
        <View style={styles.daysList}>
          {days.map((day) => {
            const dayName = weekdayNames[day.weekday] ?? `Day ${day.weekday}`;
            const activeSessions = day.sessions.filter((s) => s.active);
            const isWorking = day.active && activeSessions.length > 0;

            return (
              <View key={day.weekday} style={styles.dayCard}>
                <View style={styles.dayHeader}>
                  <Text style={styles.dayName}>{dayName}</Text>
                  <View
                    style={[
                      styles.statusPill,
                      isWorking ? styles.statusPillActive : styles.statusPillOff,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        isWorking ? styles.statusTextActive : styles.statusTextOff,
                      ]}
                    >
                      {isWorking ? 'Working' : 'Off'}
                    </Text>
                  </View>
                </View>

                {isWorking ? (
                  <View style={styles.sessionsContainer}>
                    {activeSessions.map((session) => (
                      <View key={session.session_definition_id} style={styles.sessionRow}>
                        <Text style={styles.sessionName}>{session.session_name}</Text>
                        <Text style={styles.sessionTime}>
                          {session.start_time.slice(0, 5)} – {session.end_time.slice(0, 5)}
                        </Text>
                        <Text style={styles.sessionCapacity}>
                          (cap: {session.maximum_capacity})
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.dayOffText}>Clinic closed</Text>
                )}
              </View>
            );
          })}
        </View>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  noticeBanner: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 2,
  },
  noticeText: {
    fontSize: 13,
    color: '#1E3A8A',
    lineHeight: 18,
  },
  loadingText: {
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: colors.muted,
  },
  daysList: {
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  dayCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderColor: colors.border,
    borderWidth: 1,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
  },
  statusPillActive: {
    backgroundColor: '#DCFCE7',
  },
  statusPillOff: {
    backgroundColor: '#F3F4F6',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusTextActive: {
    color: '#166534',
  },
  statusTextOff: {
    color: colors.muted,
  },
  sessionsContainer: {
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 4,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sessionName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    minWidth: 70,
  },
  sessionTime: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  sessionCapacity: {
    fontSize: 12,
    color: colors.muted,
  },
  dayOffText: {
    fontSize: 13,
    color: colors.muted,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
});
