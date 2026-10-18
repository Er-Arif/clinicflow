import { formatClinicDate } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useClinicTimeQuery, useGetScheduleQuery, useListDoctorsQuery, useListScheduleExceptionsQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { formatWorkingDays } from '@/features/scheduling/formatters';
import { colors, radius, spacing } from '@/theme/tokens';

export { formatWorkingDays };

export default function ScheduleHubScreen() {
  const router = useRouter();
  const clinicTime = useClinicTimeQuery();
  const today = clinicTime.data?.clinic_date ?? '';
  const doctors = useListDoctorsQuery();
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const doctorId = selectedDoctor ?? doctors.data?.[0]?.doctor_id ?? '';
  const scheduleQuery = useGetScheduleQuery({ doctorId, effectiveOn: today }, { skip: !doctorId || !today });
  const exceptionsQuery = useListScheduleExceptionsQuery({ doctorId, fromDate: today }, { skip: !doctorId || !today });
  const activeDayIndices = (scheduleQuery.data?.days ?? []).filter(d => d.active && d.sessions.some(s => s.active)).map(d => d.weekday);
  const exceptions = exceptionsQuery.data?.exceptions ?? [];
  const exceptionCount = exceptionsQuery.data?.total_count ?? 0;
  const nextExceptions = exceptions.slice(0, 2);

  return (
    <AppScreen>
      <BackButton />
      <QueryState query={clinicTime} label="clinic date" />
      <QueryState query={doctors} label="doctors" />
      <View style={styles.header}>
        <Text style={styles.title}>Schedule & Sessions</Text>
        <Text style={styles.subtitle}>Weekly clinic hours and time off</Text>
      </View>

      {doctors.data && doctors.data.length > 1 ? (
        <View style={styles.chips}>
          {doctors.data.map(doctor => (
            <Pressable key={doctor.doctor_id} onPress={() => setSelectedDoctor(doctor.doctor_id)} style={[styles.chip, doctorId === doctor.doctor_id && styles.chipActive]}>
              <Text style={doctorId === doctor.doctor_id ? styles.chipTextActive : styles.chipText}>{doctor.display_name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.cardHeading}>
          <Text style={styles.cardTitle}>Weekly hours</Text>
          <Text style={styles.cardHint}>Regular working schedule</Text>
        </View>
        <QueryState query={scheduleQuery} label="weekly hours" />
        <View style={styles.scheduleSummary}>
          <Text style={styles.summaryLabel}>Working days</Text>
          <Text style={styles.workingDays}>{scheduleQuery.data ? formatWorkingDays(activeDayIndices) : 'Unavailable'}</Text>
        </View>
        <AppButton label="Edit weekly hours" tone="secondary" onPress={() => router.push('/doctor/more/schedule/weekly')} />
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.cardTitle}>Exceptions & Time Off</Text>
            <Text style={styles.cardHint}>Block a date or individual session</Text>
          </View>
          <View style={styles.countBadge}><Text style={styles.countBadgeText}>{exceptionsQuery.data ? exceptionCount : '—'}</Text></View>
        </View>

        <QueryState query={exceptionsQuery} label="exceptions" />
        {exceptionsQuery.data && exceptionCount === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No upcoming time off</Text>
            <Text style={styles.subtitle}>Your regular weekly schedule is active.</Text>
          </View>
        ) : null}
        {nextExceptions.map(item => (
          <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push('/doctor/more/schedule/exceptions')} style={styles.exceptionRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.exceptionDate}>{formatClinicDate(item.date)}</Text>
              <Text style={styles.subtitle}>{item.scope === 'FULL_DAY' ? 'Full day' : item.session_name ?? 'Session'} · {item.reason}</Text>
              {item.retained_appointments_count > 0 ? <Text style={styles.retained}>{item.retained_appointments_count} booking(s) preserved</Text> : null}
            </View>
            <Text style={styles.blocked}>Blocked</Text>
          </Pressable>
        ))}

        <AppButton label="Block a date" onPress={() => router.push('/doctor/more/schedule/exceptions/new')} />
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.viewAll, pressed && styles.pressed]} onPress={() => router.push('/doctor/more/schedule/exceptions')}>
          <Text style={styles.viewAllText}>View all exceptions</Text><Text style={styles.viewAllArrow}>›</Text>
        </Pressable>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 3 },
  title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.softPrimary, borderColor: '#C8DCF9' },
  chipText: { color: colors.muted },
  chipTextActive: { color: colors.primaryDark, fontWeight: '800' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.md },
  cardHeading: { gap: 2 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  headerCopy: { flex: 1, gap: 2 },
  cardTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 17 },
  cardHint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  scheduleSummary: { backgroundColor: colors.surfaceSoft, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  summaryLabel: { color: colors.muted, fontWeight: '600', fontSize: 12 },
  workingDays: { color: colors.primaryDark, fontWeight: '800', fontSize: 16 },
  countBadge: { minWidth: 32, height: 32, borderRadius: 16, backgroundColor: colors.softPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  countBadgeText: { color: colors.primaryDark, fontWeight: '800', fontSize: 13 },
  emptyState: { backgroundColor: colors.surfaceSoft, borderRadius: radius.md, padding: spacing.md, gap: 3 },
  emptyTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
  exceptionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSoft, borderRadius: radius.md, padding: spacing.sm },
  exceptionDate: { color: colors.text, fontWeight: '700', fontSize: 14 },
  retained: { color: colors.warning, fontSize: 11, fontWeight: '600' },
  blocked: { color: colors.danger, fontWeight: '700', fontSize: 12 },
  viewAll: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  viewAllText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  viewAllArrow: { color: colors.primary, fontSize: 20, lineHeight: 20 },
  pressed: { opacity: 0.7 },
});
