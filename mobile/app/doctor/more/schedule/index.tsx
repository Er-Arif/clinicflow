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
        <Text style={styles.subtitle}>Practice hours and time off</Text>
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
        <Text style={styles.cardTitle}>Weekly hours</Text>
        <QueryState query={scheduleQuery} label="weekly hours" />
        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>Working days</Text>
          <Text style={styles.summaryValue}>{scheduleQuery.data ? formatWorkingDays(activeDayIndices) : 'Unavailable'}</Text>
        </View>
        <AppButton compact label="Edit Weekly Hours" tone="secondary" onPress={() => router.push('/doctor/more/schedule/weekly')} />
      </View>

      <View style={styles.card}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/doctor/more/schedule/exceptions')} style={styles.cardHeaderRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.cardTitle}>Exceptions & Time Off</Text>
            <Text style={styles.subtitle}>Blocked dates and sessions</Text>
          </View>
          <View style={styles.countBadge}><Text style={styles.countBadgeText}>{exceptionsQuery.data ? exceptionCount : '—'}</Text></View>
        </Pressable>

        <QueryState query={exceptionsQuery} label="exceptions" />
        {exceptionsQuery.data && exceptionCount === 0 ? <Text style={styles.subtitle}>No upcoming blocked dates.</Text> : null}
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

        <View style={styles.buttonRow}>
          <View style={styles.flexButton}><AppButton compact label="+ Block a Date" onPress={() => router.push('/doctor/more/schedule/exceptions/new')} /></View>
          <View style={styles.flexButton}><AppButton compact label="View All Exceptions" tone="secondary" onPress={() => router.push('/doctor/more/schedule/exceptions')} /></View>
        </View>
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
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  headerCopy: { flex: 1, gap: 2 },
  cardTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 17 },
  summaryBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  summaryLabel: { color: colors.muted, fontWeight: '600', fontSize: 13 },
  summaryValue: { color: colors.text, fontWeight: '700', fontSize: 13, flex: 1, flexWrap: 'wrap' },
  countBadge: { minWidth: 30, height: 30, borderRadius: 15, backgroundColor: colors.softPrimary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  countBadgeText: { color: colors.primaryDark, fontWeight: '800', fontSize: 12 },
  exceptionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSoft, borderRadius: radius.md, padding: spacing.sm },
  exceptionDate: { color: colors.text, fontWeight: '700', fontSize: 14 },
  retained: { color: colors.warning, fontSize: 11, fontWeight: '600' },
  blocked: { color: colors.danger, fontWeight: '700', fontSize: 12 },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flexButton: { flex: 1 },
});
