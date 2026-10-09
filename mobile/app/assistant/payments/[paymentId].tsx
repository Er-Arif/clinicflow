import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import {
  useConfirmPaymentMutation,
  useGetPaymentQuery,
  useMeQuery,
  useVoidPaymentMutation,
} from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { newIdempotencyKey } from '@/features/appointments/idempotency';
import { colors, radius, spacing } from '@/theme/tokens';

export default function PaymentDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ paymentId: string }>();
  const paymentId = String(params.paymentId ?? '');
  const payment = useGetPaymentQuery(paymentId, { skip: !paymentId });
  const me = useMeQuery();
  const [confirmPayment, confirmState] = useConfirmPaymentMutation();
  const [voidPayment, voidState] = useVoidPaymentMutation();
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [replace, setReplace] = useState(true);
  const [cashIdempotencyKey] = useState(() => newIdempotencyKey('pay-cash'));
  const [voidIdempotencyKey] = useState(() => newIdempotencyKey('pay-void'));

  if (payment.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!payment.data) return <AppScreen><Text style={styles.title}>Payment not found</Text></AppScreen>;
  const item = payment.data;
  const canVoid = me.data?.permissions.includes('payment.void') ?? false;

  async function confirmCash() {
    try {
      const result = await confirmPayment({ paymentId, paymentMethod: 'CASH', idempotencyKey: cashIdempotencyKey }).unwrap();
      router.replace({ pathname: '/assistant/payments/receipt', params: { paymentId: result.payment.payment_id } });
    } catch {
      // Error rendered below.
    }
  }

  async function doVoid() {
    if (voidReason.trim().length < 2) return;
    try {
      const result = await voidPayment({ paymentId, reason: voidReason.trim(), createReplacementPayment: replace, idempotencyKey: voidIdempotencyKey }).unwrap();
      setShowVoid(false);
      if (result.replacement) {
        router.replace({ pathname: '/assistant/payments/[paymentId]', params: { paymentId: result.replacement.payment_id } });
      }
    } catch {
      // Error rendered below.
    }
  }

  return (
    <AppScreen>
      <Text style={styles.title}>{item.patient_name}</Text>
      <Text style={styles.status}>{item.status}</Text>
      <View style={styles.card}>
        <Row label="Patient ID" value={item.patient_code} />
        <Row label="Visit date" value={item.visit_date} />
        <Row label="Type" value={item.appointment_type.replace('_', ' ')} />
        <Row label="Amount due" value={`₹${item.amount_due}`} />
        {item.amount_paid != null ? <Row label="Amount paid" value={`₹${item.amount_paid}`} /> : null}
        <Row label="Method" value={item.payment_method ?? 'Not selected'} />
        {item.receipt_number ? <Row label="Receipt" value={item.receipt_number} /> : null}
        {item.void_reason ? <Row label="Void reason" value={item.void_reason} /> : null}
      </View>

      {item.status === 'PENDING' ? (
        <>
          <AppButton label={`Confirm ₹${item.amount_due} Cash`} loading={confirmState.isLoading} onPress={() => void confirmCash()} />
          <AppButton label="Pay by UPI" tone="secondary" onPress={() => router.push({ pathname: '/assistant/payments/upi', params: { paymentId } })} />
        </>
      ) : null}
      {item.status === 'CONFIRMED' && item.receipt_number ? (
        <AppButton label="View Receipt" onPress={() => router.push({ pathname: '/assistant/payments/receipt', params: { paymentId } })} />
      ) : null}
      {item.status === 'CONFIRMED' && canVoid ? (
        <AppButton label="Void Payment" tone="danger" onPress={() => setShowVoid((value) => !value)} />
      ) : null}
      {showVoid ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Controlled financial correction</Text>
          <Text style={styles.warning}>The original payment and receipt stay in history.</Text>
          <TextInput value={voidReason} onChangeText={setVoidReason} placeholder="Reason for void" style={styles.input} />
          <AppButton label={replace ? 'Create replacement payment: Yes' : 'Create replacement payment: No'} tone="secondary" onPress={() => setReplace((value) => !value)} />
          <AppButton label="Confirm Void" tone="danger" loading={voidState.isLoading} disabled={voidReason.trim().length < 2} onPress={() => void doVoid()} />
        </View>
      ) : null}
      {confirmState.error ? <Text style={styles.error}>{apiError(confirmState.error)?.message ?? 'Unable to confirm payment.'}</Text> : null}
      {voidState.error ? <Text style={styles.error}>{apiError(voidState.error)?.message ?? 'Unable to void payment.'}</Text> : null}
      <AppButton label="Back to Payments" tone="secondary" onPress={() => router.replace('/assistant/payments')} />
    </AppScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  status: { color: colors.primary, fontWeight: '900' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.md },
  cardTitle: { fontWeight: '800', color: colors.text },
  warning: { color: colors.warning },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted },
  value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.background },
  error: { color: colors.danger },
});
