import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useCompleteVisitMutation, useGetAppointmentQuery } from '@/api/api';
import { apiError } from '@/api/errors';
import { DatePicker } from '@/components/DatePicker';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { useIntentIdempotencyKey } from '@/features/appointments/idempotency';
import { followUpBookingParams } from '@/features/followups/navigation';
import type { FollowUp } from '@/features/followups/types';
import { colors, radius, spacing } from '@/theme/tokens';

function paymentStatus(value?: string | null) {
  if (!value) return 'Pending';
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export default function CompleteVisitScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ appointmentId: string }>();
  const appointmentId = String(params.appointmentId ?? '');
  const appointment = useGetAppointmentQuery(appointmentId, { skip: !appointmentId });
  const [completeVisit, completeState] = useCompleteVisitMutation();
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [mode, setMode] = useState<'INTERVAL' | 'DATE'>('INTERVAL');
  const [intervalDays, setIntervalDays] = useState('7');
  const [dueDate, setDueDate] = useState('');
  const [resultFollowup, setResultFollowup] = useState<FollowUp | null>(null);
  const [completed, setCompleted] = useState(false);

  const followUpPayload = !followUpRequired
    ? null
    : mode === 'INTERVAL'
      ? { interval_days: Number(intervalDays) }
      : { due_date: dueDate };
  const completionIntent = JSON.stringify({
    visit_id: appointment.data?.visit_id ?? null,
    follow_up: followUpPayload,
  });
  const completionRequest = useIntentIdempotencyKey('complete', completionIntent);

  if (appointment.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!appointment.data) {
    return (
      <AppScreen>
        <BackButton />
        <Text style={styles.title}>Unable to load appointment</Text>
        <QueryState query={appointment} label="appointment" />
      </AppScreen>
    );
  }
  const item = appointment.data;

  async function submit() {
    if (!item.visit_id) return;
    try {
      const result = await completeVisit({
        visitId: item.visit_id,
        body: { follow_up: followUpPayload },
        idempotencyKey: completionRequest.getKey(),
      }).unwrap();
      await appointment.refetch();
      setResultFollowup(result.followup ?? null);
      setCompleted(true);
    } catch {
      // The current request error is rendered below.
    }
  }

  const completionError = completionRequest.resultMatchesIntent ? apiError(completeState.error) : null;

  if (completed) {
    return (
      <AppScreen>
        <Text style={styles.title}>Visit completed</Text>
        <Text style={styles.subtitle}>{item.patient.full_name}</Text>
        <View style={styles.card}>
          <Text style={styles.strong}>Payment: {paymentStatus(item.payment_status)}</Text>
          <Text style={styles.subtitle}>
            {resultFollowup ? 'Follow-up recommendation saved.' : 'No follow-up recommendation.'}
          </Text>
        </View>
        {resultFollowup ? (
          <AppButton
            label="Book follow-up now"
            onPress={() => router.replace({ pathname: '/assistant/appointments/new', params: followUpBookingParams(resultFollowup) })}
          />
        ) : null}
        <AppButton label="Done" tone="secondary" onPress={() => router.replace('/assistant/appointments')} />
      </AppScreen>
    );
  }

  return (
    <KeyboardSafeFormScreen>
      <QueryState query={appointment} label="appointment" />
      <BackButton />
      <Text style={styles.title}>Complete visit</Text>
      <Text style={styles.subtitle}>{item.patient.full_name} · Payment {paymentStatus(item.payment_status)}</Text>

      <View style={styles.card}>
        <Text style={styles.strong}>Follow-up required?</Text>
        <View style={styles.actions}>
          <AppButton label="No" tone={!followUpRequired ? 'primary' : 'secondary'} onPress={() => setFollowUpRequired(false)} />
          <AppButton label="Yes" tone={followUpRequired ? 'primary' : 'secondary'} onPress={() => setFollowUpRequired(true)} />
        </View>
      </View>

      {followUpRequired ? (
        <View style={styles.card}>
          <Text style={styles.strong}>Follow-up timing</Text>
          <View style={styles.actions}>
            <AppButton label="After N days" tone={mode === 'INTERVAL' ? 'primary' : 'secondary'} onPress={() => setMode('INTERVAL')} />
            <AppButton label="Specific date" tone={mode === 'DATE' ? 'primary' : 'secondary'} onPress={() => setMode('DATE')} />
          </View>
          {mode === 'INTERVAL' ? (
            <KeyboardSafeTextInput
              value={intervalDays}
              onChangeText={setIntervalDays}
              keyboardType="number-pad"
              placeholder="7"
              style={styles.input}
            />
          ) : (
            <DatePicker value={dueDate} onChange={setDueDate} placeholder="YYYY-MM-DD" />
          )}
        </View>
      ) : null}

      {completionError ? <Text style={styles.error}>{completionError.message ?? 'Unable to complete visit.'}</Text> : null}
      <AppButton
        label="Complete visit"
        loading={completeState.isLoading}
        disabled={
          !item.visit_id ||
          (followUpRequired && mode === 'INTERVAL' && (!Number.isInteger(Number(intervalDays)) || Number(intervalDays) < 1)) ||
          (followUpRequired && mode === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))
        }
        onPress={() => void submit()}
      />
      <AppButton label="Cancel" tone="secondary" onPress={() => router.back()} />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  strong: { color: colors.text, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  actions: { gap: spacing.sm },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.background },
  error: { color: colors.danger },
});
