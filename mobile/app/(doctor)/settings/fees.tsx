import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useClinicTimeQuery, useCreateFeeConfigurationMutation, useGetCurrentFeeQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { FormField } from '@/components/FormField';
import { colors, radius, spacing } from '@/theme/tokens';

export default function FeeSettingsScreen() {
  const router = useRouter();
  const clinicTime = useClinicTimeQuery();
  const current = useGetCurrentFeeQuery();
  const [save, saveState] = useCreateFeeConfigurationMutation();
  const today = clinicTime.data?.clinic_date ?? '';
  const tomorrow = today ? addDays(today, 1) : '';
  const [effectiveFrom, setEffectiveFrom] = useState('');
  useEffect(() => {
    if (!effectiveFrom && today) setEffectiveFrom(today);
  }, [effectiveFrom, today]);
  const [regularFee, setRegularFee] = useState('500.00');
  const [followupFee, setFollowupFee] = useState('300.00');
  const [assistantAdjust, setAssistantAdjust] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setMessage(null);
    try {
      await save({
        effective_from: effectiveFrom,
        regular_fee: regularFee,
        followup_fee: followupFee,
        assistant_adjustment_allowed: assistantAdjust,
      }).unwrap();
      setMessage('Fee configuration saved.');
      void current.refetch();
    } catch (error) {
      setMessage(apiError(error)?.message ?? 'Unable to save fees.');
    }
  }

  function prepareNextVersion() {
    if (!current.data) return;
    setRegularFee(String(current.data.regular_fee));
    setFollowupFee(String(current.data.followup_fee));
    setAssistantAdjust(current.data.assistant_adjustment_allowed);
    setEffectiveFrom(tomorrow);
  }

  return (
    <AppScreen>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Fee Settings</Text>
          <Text style={styles.subtitle}>Fee changes apply to new bookings only.</Text>
        </View>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      </View>

      {current.data ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Current fees</Text>
          <Text style={styles.value}>Regular ₹{money(current.data.regular_fee)}</Text>
          <Text style={styles.value}>Follow-up ₹{money(current.data.followup_fee)}</Text>
          <Text style={styles.subtitle}>Effective from {current.data.effective_from}</Text>
          <AppButton label="Prepare Next Fee Version" tone="secondary" onPress={prepareNextVersion} />
        </View>
      ) : null}

      <FormField label="Effective From" value={effectiveFrom} onChangeText={setEffectiveFrom} placeholder="YYYY-MM-DD" />
      <FormField label="Regular Consultation Fee" value={regularFee} onChangeText={setRegularFee} keyboardType="decimal-pad" />
      <FormField label="Follow-up Fee" value={followupFee} onChangeText={setFollowupFee} keyboardType="decimal-pad" />
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Allow Assistant Fee Adjustment</Text>
          <Text style={styles.subtitle}>Every adjustment will still require a reason and audit entry.</Text>
        </View>
        <Switch value={assistantAdjust} onValueChange={setAssistantAdjust} />
      </View>
      {message ? <Text style={message.includes('saved') ? styles.success : styles.error}>{message}</Text> : null}
      <AppButton label="Save Fee Version" onPress={() => void submit()} loading={saveState.isLoading} />
    </AppScreen>
  );
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function money(value: string | number) {
  return Number(value).toFixed(2);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '700', paddingTop: 6 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: 17 },
  value: { color: colors.text, fontSize: 16, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { color: colors.text, fontWeight: '700' },
  success: { color: colors.success, fontWeight: '700' },
  error: { color: colors.danger },
});
