import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useClinicTimeQuery, useListRemindersQuery, useSkipReminderMutation } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

export default function RemindersScreen() {
  const router = useRouter();
  const clinicTime = useClinicTimeQuery();
  const reminders = useListRemindersQuery(
    { status: 'DUE', dueThrough: clinicTime.data?.clinic_date },
    { skip: !clinicTime.data?.clinic_date },
  );
  const [skipReminder, skipState] = useSkipReminderMutation();
  const [error, setError] = useState<string | null>(null);

  async function skip(reminderId: string) {
    setError(null);
    try {
      await skipReminder({ reminderId, reason: 'Skipped by Assistant' }).unwrap();
    } catch (e) {
      setError(apiError(e)?.message ?? 'Unable to skip reminder.');
    }
  }

  return (
    <AppScreen>
      <BackButton />
      <Text style={styles.title}>Reminders</Text>
      <Text style={styles.subtitle}>Due through {clinicTime.data?.clinic_date ?? 'today'} · WhatsApp is sent manually.</Text>
      {reminders.isFetching ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {reminders.data?.items.length === 0 ? <Text style={styles.subtitle}>All reminders are handled.</Text> : null}
      {reminders.data?.items.map((item) => (
        <View key={item.reminder_id} style={styles.card}>
          <Text style={styles.patient}>{item.patient_name}</Text>
          <Text style={styles.subtitle}>{item.reminder_type.replaceAll('_', ' ')} · Due {item.due_on} · {item.language}</Text>
          {!item.sendable ? <Text style={styles.warning}>Temporarily suppressed: {item.suppression_reason?.replaceAll('_', ' ')}</Text> : null}
          <AppButton
            label="Send WhatsApp"
            disabled={!item.sendable}
            onPress={() => router.push({ pathname: '/assistant/reminders/preview', params: { reminderId: item.reminder_id } })}
          />
          <AppButton label="Skip" tone="secondary" loading={skipState.isLoading} onPress={() => void skip(item.reminder_id)} />
        </View>
      ))}
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

