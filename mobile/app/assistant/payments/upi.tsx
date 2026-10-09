import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';

import { apiError } from '@/api/errors';
import { useConfirmPaymentMutation, useGetUpiIntentQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { newIdempotencyKey } from '@/features/appointments/idempotency';
import { colors, radius, spacing } from '@/theme/tokens';

export default function UpiPaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ paymentId: string }>();
  const paymentId = String(params.paymentId ?? '');
  const intent = useGetUpiIntentQuery(paymentId, { skip: !paymentId });
  const [confirmPayment, confirmState] = useConfirmPaymentMutation();
  const [idempotencyKey] = useState(() => newIdempotencyKey('pay-upi'));

  async function confirm() {
    try {
      const result = await confirmPayment({ paymentId, paymentMethod: 'UPI', idempotencyKey }).unwrap();
      router.replace({ pathname: '/assistant/payments/receipt', params: { paymentId: result.payment.payment_id } });
    } catch {
      // Error rendered below.
    }
  }

  if (intent.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!intent.data) return <AppScreen><Text style={styles.error}>{apiError(intent.error)?.message ?? 'Unable to prepare UPI payment.'}</Text></AppScreen>;

  return (
    <AppScreen contentStyle={styles.content}>
      <Text style={styles.title}>UPI Payment</Text>
      <Text style={styles.amount}>₹{intent.data.amount}</Text>
      <View style={styles.qrCard}>
        <QRCode value={intent.data.upi_uri} size={240} />
      </View>
      <Text style={styles.payee}>{intent.data.payee_name}</Text>
      <Text style={styles.meta}>{intent.data.upi_id}</Text>
      <Text style={styles.warning}>Payment is not confirmed automatically. Verify receipt in the UPI app/bank view before confirming.</Text>
      <AppButton label="Confirm Payment Received" loading={confirmState.isLoading} onPress={() => void confirm()} />
      <AppButton label="Back" tone="secondary" onPress={() => router.back()} />
      {confirmState.error ? <Text style={styles.error}>{apiError(confirmState.error)?.message ?? 'Unable to confirm payment.'}</Text> : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'stretch' },
  title: { fontSize: 28, fontWeight: '800', color: colors.text, textAlign: 'center' },
  amount: { fontSize: 34, fontWeight: '900', color: colors.text, textAlign: 'center' },
  qrCard: { alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  payee: { textAlign: 'center', fontWeight: '800', color: colors.text, fontSize: 17 },
  meta: { textAlign: 'center', color: colors.muted },
  warning: { color: colors.warning, backgroundColor: '#FFF7ED', borderRadius: radius.md, padding: spacing.md, lineHeight: 20 },
  error: { color: colors.danger },
});

