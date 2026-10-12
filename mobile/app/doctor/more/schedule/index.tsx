import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  useClinicTimeQuery,
  useGetScheduleQuery,
  useListDoctorsQuery,
  useListScheduleExceptionsQuery,
} from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ScheduleHubScreen() {
  const router = useRouter();
  const clinicTime = useClinicTimeQuery();
  const today = clinicTime.data?.clinic_date ?? '';
  const doctors = useListDoctorsQuery();
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const doctorId = selectedDoctor ?? doctors.data?.[0]?.doctor_id ?? '';

  const scheduleQuery = useGetScheduleQuery(
    { doctorId, effectiveOn: today },
    { skip: !doctorId }
  );

  const exceptionsQuery = useListScheduleExceptionsQuery(
    { doctorId, fromDate: today },
    { skip: !doctorId }
  );

  const activeDays = (scheduleQuery.data?.days ?? [])
    .filter((d) => d.active && d.sessions.some((s) => s.active))
    .map((d) => weekdays[d.weekday]);

  const exceptions = exceptionsQuery.data?.exceptions ?? [];
  const exceptionCount = exceptionsQuery.data?.total_count ?? 0;
  const nextExceptions = exceptions.slice(0, 2);

  return (
    <AppScreen>
      <BackButton />
      <View style={styles.header}>
        <Text style={styles.title}>Schedule & Sessions</Text>
        <Text style={styles.subtitle}>
          Manage your recurring weekly practice hours and upcoming date exceptions.
        </Text>
      </View>

      {doctors.data && doctors.data.length > 1 && (
        <View style={styles.section}>
          <Text style={styles.label}>Doctor</Text>
          <View style={styles.chips}>
            {doctors.data.map((doctor) => (
              <Pressable
                key={doctor.doctor_id}
                onPress={() => setSelectedDoctor(doctor.doctor_id)}
                style={[styles.chip, doctorId === doctor.doctor_id && styles.chipActive]}
              >
                <Text style={doctorId === doctor.doctor_id ? styles.chipTextActive : styles.chipText}>
                  {doctor.display_name}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {/* Section 1: Standard Weekly Hours */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Standard Weekly Hours</Text>
        <Text style={styles.cardSubtitle}>
          Recurring weekly operating schedule across weekdays.
        </Text>

        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>Working Days:</Text>
          <Text style={styles.summaryValue}>
            {activeDays.length > 0 ? activeDays.join(', ') : 'No recurring hours active'}
          </Text>
        </View>

        <Text style={styles.noteText}>
          Standard schedule edits apply safely without modifying past versions.
        </Text>

        <AppButton
          label="Edit Weekly Hours"
          tone="secondary"
          onPress={() => router.push('/doctor/more/schedule/weekly')}
        />
      </View>

      {/* Section 2: Exceptions & Time Off */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Exceptions & Time Off</Text>
            <Text style={styles.cardSubtitle}>
              Specific dates or sessions blocked for conferences, leave, or holidays.
            </Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{exceptionCount}</Text>
          </View>
        </View>

        {exceptionsQuery.isLoading ? (
          <Text style={styles.loadingText}>Loading exceptions...</Text>
        ) : exceptionCount === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No upcoming blocked dates</Text>
            <Text style={styles.emptyStateSubtext}>
              Doctor is available on all scheduled weekly days.
            </Text>
          </View>
        ) : (
          <View style={{ gap: spacing.xs }}>
            <Text style={styles.subheading}>Next Blocked Date(s):</Text>
            {nextExceptions.map((item) => (
              <View key={item.id} style={styles.exceptionRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.exceptionDate}>{item.date}</Text>
                  <Text style={styles.exceptionDetails}>
                    {item.scope === 'FULL_DAY' ? 'Full Day' : item.session_name ?? 'Session'} • {item.reason}
                  </Text>
                  {item.retained_appointments_count > 0 && (
                    <Text style={styles.retainedText}>
                      {item.retained_appointments_count} existing booking(s) preserved
                    </Text>
                  )}
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>BLOCKED</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.buttonRow}>
          <View style={{ flex: 1 }}>
            <AppButton
              label="+ Block a Date"
              tone="primary"
              onPress={() => router.push('/doctor/more/schedule/exceptions/new')}
            />
          </View>
          {exceptionCount > 0 && (
            <View style={{ flex: 1 }}>
              <AppButton
                label="View All Exceptions"
                tone="secondary"
                onPress={() => router.push('/doctor/more/schedule/exceptions')}
              />
            </View>
          )}
        </View>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4 },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  section: { gap: spacing.xs },
  label: { color: colors.text, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipActive: { backgroundColor: colors.softPrimary, borderColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: 18 },
  cardSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  summaryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  summaryLabel: { color: colors.muted, fontWeight: '600', fontSize: 14 },
  summaryValue: { color: colors.text, fontWeight: '700', fontSize: 14 },
  noteText: { color: colors.muted, fontSize: 12, fontStyle: 'italic' },
  countBadge: {
    backgroundColor: colors.softPrimary,
    borderRadius: 999,
    minWidth: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  countBadgeText: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  loadingText: { color: colors.muted, paddingVertical: spacing.sm },
  emptyState: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
  },
  emptyStateText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  emptyStateSubtext: { color: colors.muted, fontSize: 12 },
  subheading: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  exceptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  exceptionDate: { color: colors.text, fontWeight: '700', fontSize: 15 },
  exceptionDetails: { color: colors.muted, fontSize: 13 },
  retainedText: { color: colors.warning, fontSize: 12, fontWeight: '600' },
  statusBadge: {
    backgroundColor: colors.danger,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
