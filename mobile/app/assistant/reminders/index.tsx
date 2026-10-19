import { formatClinicDate } from '@/utils/dates';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useClinicTimeQuery, useReminderWorklistInfiniteQuery, useSkipReminderMutation } from '@/api/api';
import { worklistItems } from '@/api/worklists';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { WorklistControls } from '@/components/WorklistControls';
import { colors, radius, spacing } from '@/theme/tokens';

function humanize(value?: string | null) {
  if (!value) return '';
  const normalized = value.replaceAll('_', ' ').trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : value;
}

export default function RemindersScreen() {
  const router = useRouter();
  const clinicTime = useClinicTimeQuery();
  const reminders = useReminderWorklistInfiniteQuery(
    { status: 'DUE', dueThrough: clinicTime.data?.clinic_date },
    { skip: !clinicTime.data?.clinic_date, refetchOnMountOrArgChange: true },
  );
  const [skipReminder, skipState] = useSkipReminderMutation();
  const [error, setError] = useState<string | null>(null);
  const items = worklistItems(reminders.currentData, item => item.reminder_id);

  async function skip(reminderId: string) {
    setError(null);
    try {
      await skipReminder({ reminderId, reason: 'Skipped by assistant' }).unwrap();
    } catch (e) {
      setError(apiError(e)?.message ?? 'Unable to skip reminder.');
    }
  }

  return (
    <AppScreen refreshing={reminders.isFetching && !reminders.isFetchingNextPage}
      onRefresh={() => { if (clinicTime.data?.clinic_date) void reminders.refetch(); else void clinicTime.refetch(); }}>
      <BackButton />
      <Text style={styles.title}>Reminders</Text>
      <Text style={styles.subtitle}>Due through {clinicTime.data?.clinic_date ?? 'today'} · WhatsApp is sent manually.</Text>
      {clinicTime.isLoading ? <ActivityIndicator /> : null}
      {clinicTime.isError ? <>
        <Text style={styles.error}>Unable to load clinic date.</Text>
        <AppButton label="Retry" tone="secondary" onPress={() => { void clinicTime.refetch(); }} />
      </> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {items.map((item) => (
        <View key={item.reminder_id} style={styles.card}>
          <Text style={styles.patient}>{item.patient_name}</Text>
          <Text style={styles.subtitle}>{humanize(item.reminder_type)} · Due {formatClinicDate(item.due_on)} · {item.language}</Text>
          {!item.sendable ? <Text style={styles.warning}>Temporarily suppressed: {humanize(item.suppression_reason)}</Text> : null}
          <AppButton
            label="Send WhatsApp"
            disabled={!item.sendable}
            onPress={() => router.push({ pathname: '/assistant/reminders/preview', params: { reminderId: item.reminder_id } })}
          />
          <AppButton label="Skip" tone="secondary" loading={skipState.isLoading} onPress={() => void skip(item.reminder_id)} />
        </View>
      ))}
      <WorklistControls query={reminders} count={items.length} emptyText="All reminders are handled." />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger },
  warning: { color: colors.warning, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  patient: { fontSize: 17, fontWeight: '800', color: colors.text },
});
