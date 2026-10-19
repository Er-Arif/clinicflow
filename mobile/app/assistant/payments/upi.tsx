import { QueryState } from '@/components/QueryState';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { apiError } from '@/api/errors';
import { useConfirmPaymentMutation, useGetUpiIntentQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { newIdempotencyKey } from '@/features/appointments/idempotency';
import { colors, radius, spacing } from '@/theme/tokens';
export default function UpiPaymentScreen() {
  const router = useRouter(); const params = useLocalSearchParams<{ paymentId: string; appointmentId?: string; visitId?: string }>(); const paymentId = String(params.paymentId ?? ''); const appointmentId = params.appointmentId ? String(params.appointmentId) : undefined; const visitId = params.visitId ? String(params.visitId) : undefined;
  const intent = useGetUpiIntentQuery(paymentId, { skip: !paymentId }); const [confirmPayment, confirmState] = useConfirmPaymentMutation(); const [idempotencyKey] = useState(() => newIdempotencyKey('pay-upi'));
  async function confirm() { try { const result = await confirmPayment({ paymentId, paymentMethod: 'UPI', idempotencyKey, appointmentId, visitId }).unwrap(); router.replace({ pathname: '/assistant/payments/receipt', params: { paymentId: result.payment.payment_id } }); } catch {} }
  if (intent.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>; if (!intent.data) return <AppScreen><BackButton /><Text style={styles.error}>{apiError(intent.error)?.message ?? 'Unable to prepare UPI payment.'}</Text><QueryState query={intent} label="UPI payment details" /></AppScreen>;
  return <AppScreen contentStyle={styles.content}><BackButton /><Text style={styles.title}>UPI payment</Text><Text style={styles.amount}>₹{intent.data.amount}</Text><View style={styles.qrCard}><QRCode value={intent.data.upi_uri} size={230} /></View><Text style={styles.payee}>{intent.data.payee_name}</Text><Text style={styles.meta}>{intent.data.upi_id}</Text><View style={styles.notice}><Text style={styles.noticeText}>Verify the payment in your UPI or bank app before confirming.</Text></View><AppButton label="Confirm payment received" loading={confirmState.isLoading} onPress={() => void confirm()} />{confirmState.error ? <Text style={styles.error}>{apiError(confirmState.error)?.message ?? 'Unable to confirm payment.'}</Text> : null}</AppScreen>;
}
const styles = StyleSheet.create({ content: { alignItems: 'stretch' }, title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark, textAlign: 'center' }, amount: { fontSize: 34, fontWeight: '800', color: colors.primaryDark, textAlign: 'center' }, qrCard: { alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, borderWidth: 1, borderColor: colors.border }, payee: { textAlign: 'center', fontWeight: '800', color: colors.text, fontSize: 16 }, meta: { textAlign: 'center', color: colors.muted, fontSize: 13 }, notice: { backgroundColor: colors.softWarning, borderRadius: radius.md, padding: spacing.md }, noticeText: { color: colors.warning, fontSize: 13, lineHeight: 18 }, error: { color: colors.danger } });
