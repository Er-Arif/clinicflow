import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { apiError } from '@/api/errors';
import { useClinicTimeQuery, useCreateFeeConfigurationMutation, useGetCurrentFeeQuery } from '@/api/api';
import { DatePicker } from '@/components/DatePicker';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { FormField } from '@/components/FormField';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate } from '@/utils/dates';

export default function FeeSettingsScreen() {
  const clinicTime = useClinicTimeQuery();
  const current = useGetCurrentFeeQuery();
  const [save, saveState] = useCreateFeeConfigurationMutation();
  const today = clinicTime.data?.clinic_date ?? '';
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [regularFee, setRegularFee] = useState('');
  const [followupFee, setFollowupFee] = useState('');
  const [assistantAdjust, setAssistantAdjust] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveFrom && today) setEffectiveFrom(today);
  }, [effectiveFrom, today]);

  useEffect(() => {
    if (!current.data) return;
    setRegularFee(money(current.data.regular_fee));
    setFollowupFee(money(current.data.followup_fee));
    setAssistantAdjust(current.data.assistant_adjustment_allowed);
  }, [current.data]);

  async function submit() {
    setMessage(null);
    try {
      await save({
        effective_from: effectiveFrom,
        regular_fee: regularFee,
        followup_fee: followupFee,
        assistant_adjustment_allowed: assistantAdjust,
      }).unwrap();
      setMessage('Consultation fees saved.');
      void current.refetch();
    } catch (error) {
      setMessage(apiError(error)?.message ?? 'Unable to save consultation fees.');
    }
  }

  const canSave = Boolean(effectiveFrom && regularFee.trim() && followupFee.trim() && !saveState.isLoading);

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <Text style={styles.title}>Consultation fees</Text>
      <Text style={styles.subtitle}>Changes apply to new bookings only.</Text>

      {current.data ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Current fees</Text>
          <Text style={styles.value}>Regular ₹{money(current.data.regular_fee)}</Text>
          <Text style={styles.value}>Follow-up ₹{money(current.data.followup_fee)}</Text>
          <Text style={styles.subtitle}>Effective from {formatClinicDate(current.data.effective_from)}</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>New fees</Text>
        <Text style={styles.subtitle}>Start from the current amounts, then choose when the change should take effect.</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.label}>Effective from</Text>
        <DatePicker value={effectiveFrom} onChange={setEffectiveFrom} placeholder="YYYY-MM-DD" />
      </View>
      <FormField label="Regular consultation fee" value={regularFee} onChangeText={setRegularFee} keyboardType="decimal-pad" />
      <FormField label="Follow-up fee" value={followupFee} onChangeText={setFollowupFee} keyboardType="decimal-pad" />
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Allow assistant fee adjustment</Text>
          <Text style={styles.subtitle}>Every adjustment still requires a reason and audit entry.</Text>
        </View>
        <Switch value={assistantAdjust} onValueChange={setAssistantAdjust} />
      </View>
      {message ? <Text style={message.includes('saved') ? styles.success : styles.error}>{message}</Text> : null}
      <AppButton label="Save new fees" onPress={() => void submit()} loading={saveState.isLoading} disabled={!canSave} />
    </KeyboardSafeFormScreen>
  );
}

function money(value: string | number) {
  return Number(value).toFixed(2);
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: 17 },
  value: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sectionHeader: { gap: 3, marginTop: spacing.xs },
  sectionTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 17 },
  fieldGroup: { gap: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { color: colors.text, fontWeight: '700' },
  success: { color: colors.success, fontWeight: '700' },
  error: { color: colors.danger },
});
