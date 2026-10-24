import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useClinicTimeQuery, useCompleteVisitMutation, useGetAppointmentQuery } from '@/api/api';
import { apiError } from '@/api/errors';
import { DatePicker } from '@/components/DatePicker';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { useIntentIdempotencyKey } from '@/features/appointments/idempotency';
import type { FollowUp } from '@/features/followups/types';
import { useFocusedHardwareBack } from '@/navigation/useFocusedHardwareBack';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate } from '@/utils/dates';

function paymentStatus(value?: string | null) {
  if (!value) return 'Pending';
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export default function CompleteVisitScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ appointmentId: string }>();
  const appointmentId = String(params.appointmentId ?? '');
  const appointment = useGetAppointmentQuery(appointmentId, { skip: !appointmentId });
  const clinicTime = useClinicTimeQuery();
  const [completeVisit, completeState] = useCompleteVisitMutation();
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [mode, setMode] = useState<'INTERVAL' | 'DATE'>('INTERVAL');
  const [intervalDays, setIntervalDays] = useState('7');
  const [dueDate, setDueDate] = useState('');
  const [lateCompletionReason, setLateCompletionReason] = useState('');
  const [resultFollowup, setResultFollowup] = useState<FollowUp | null>(null);
  const [completed, setCompleted] = useState(false);

  function exitCompleted() {
    router.dismissTo('/assistant/appointments');
  }

  // Once the visit is committed, Back must not reopen the completed form path.
  useFocusedHardwareBack(exitCompleted, completed);

  const followUpPayload = !followUpRequired
    ? null
    : mode === 'INTERVAL'
      ? { interval_days: Number(intervalDays) }
      : { due_date: dueDate };
  const visitDate = appointment.data?.session.date ?? '';
  const clinicDate = clinicTime.data?.clinic_date ?? '';
  const isLateCompletion = Boolean(visitDate && clinicDate && visitDate < clinicDate);
  const completionIntent = JSON.stringify({
    visit_id: appointment.data?.visit_id ?? null,
    follow_up: followUpPayload,
    late_completion_reason: isLateCompletion ? lateCompletionReason.trim() : null,
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
        body: {
          follow_up: followUpPayload,
          ...(isLateCompletion ? { late_completion_reason: lateCompletionReason.trim() } : {}),
        },
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
            onPress={() => router.replace({ pathname: '/assistant/followups/book', params: { followupId: resultFollowup.followup_id } })}
          />
        ) : null}
        <AppButton label="Done" tone="secondary" onPress={exitCompleted} />
      </AppScreen>
    );
  }

  return (
    <KeyboardSafeFormScreen>
      <QueryState query={appointment} label="appointment" />
      <QueryState query={clinicTime} label="clinic date" />
      <BackButton />
      <Text style={styles.title}>{isLateCompletion ? 'Resolve previous-day visit' : 'Complete visit'}</Text>
      <Text style={styles.subtitle}>{item.patient.full_name} · Payment {paymentStatus(item.payment_status)}</Text>

      {isLateCompletion ? (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>Previous-day OPD visit left open</Text>
          <Text style={styles.subtitle}>
            Visit date: {formatClinicDate(visitDate)}. OPD visits should normally be completed on the same clinic day. Closing it now records a late administrative closure without moving the clinical visit to today.
          </Text>
          <KeyboardSafeTextInput
            value={lateCompletionReason}
            onChangeText={setLateCompletionReason}
            placeholder="Why was this visit left open?"
            style={styles.input}
            maxLength={500}
          />
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.strong}>Follow-up required?</Text>
        <View style={styles.actions}>
          <AppButton label="No" tone={!followUpRequired ? 'selection' : 'secondary'} onPress={() => setFollowUpRequired(false)} />
          <AppButton label="Yes" tone={followUpRequired ? 'selection' : 'secondary'} onPress={() => setFollowUpRequired(true)} />
        </View>
      </View>

      {followUpRequired ? (
        <View style={styles.card}>
          <Text style={styles.strong}>Follow-up timing</Text>
          <View style={styles.actions}>
            <AppButton label="After N days" tone={mode === 'INTERVAL' ? 'selection' : 'secondary'} onPress={() => setMode('INTERVAL')} />
            <AppButton label="Specific date" tone={mode === 'DATE' ? 'selection' : 'secondary'} onPress={() => setMode('DATE')} />
          </View>
          {mode === 'INTERVAL' ? (
            <>
              <KeyboardSafeTextInput
                value={intervalDays}
                onChangeText={setIntervalDays}
                keyboardType="number-pad"
                placeholder="7"
                style={styles.input}
              />
              <Text style={styles.helper}>Interval starts from the visit date ({formatClinicDate(visitDate)}).</Text>
            </>
          ) : (
            <DatePicker value={dueDate} onChange={setDueDate} placeholder="YYYY-MM-DD" />
          )}
        </View>
      ) : null}

      {completionError ? <Text style={styles.error}>{completionError.message ?? 'Unable to complete visit.'}</Text> : null}
      <AppButton
        label={isLateCompletion ? 'Close visit as completed' : 'Complete visit'}
        loading={completeState.isLoading}
        disabled={
          !item.visit_id ||
          (isLateCompletion && lateCompletionReason.trim().length < 2) ||
          (followUpRequired && mode === 'INTERVAL' && (!Number.isInteger(Number(intervalDays)) || Number(intervalDays) < 1)) ||
          (followUpRequired && mode === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))
        }
        onPress={() => void submit()}
      />
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  strong: { color: colors.text, fontWeight: '800' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  warningCard: { backgroundColor: colors.softWarning, borderWidth: 1, borderColor: colors.warning, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  warningTitle: { color: colors.warning, fontWeight: '800' },
  actions: { gap: spacing.sm },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.background },
  error: { color: colors.danger },
});