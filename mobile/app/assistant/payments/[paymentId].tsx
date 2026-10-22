import { formatClinicDate } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { apiError } from '@/api/errors';
import { useConfirmPaymentMutation, useGetPaymentQuery, useMeQuery, useVoidPaymentMutation } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { useIntentIdempotencyKey } from '@/features/appointments/idempotency';
import { colors, radius, spacing } from '@/theme/tokens';

function paymentStatus(value: string) { return value.charAt(0) + value.slice(1).toLowerCase(); }
function paymentMethod(value: string) { return value === 'UPI' ? 'UPI' : paymentStatus(value); }

export default function PaymentDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ paymentId: string; appointmentId?: string; visitId?: string }>();
  const paymentId = String(params.paymentId ?? '');
  const appointmentId = params.appointmentId ? String(params.appointmentId) : undefined;
  const visitId = params.visitId ? String(params.visitId) : undefined;
  const payment = useGetPaymentQuery(paymentId, { skip: !paymentId });
  const me = useMeQuery();
  const [confirmPayment, confirmState] = useConfirmPaymentMutation();
  const [voidPayment, voidState] = useVoidPaymentMutation();
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [replace, setReplace] = useState(true);

  const cashRequest = useIntentIdempotencyKey('pay-cash', JSON.stringify({
    payment_id: paymentId,
    payment_method: 'CASH',
  }));
  const voidRequest = useIntentIdempotencyKey('pay-void', JSON.stringify({
    payment_id: paymentId,
    reason: voidReason.trim(),
    create_replacement_payment: replace,
  }));

  if (payment.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!payment.data) return <AppScreen><BackButton /><Text style={styles.title}>Payment not found</Text><QueryState query={payment} label="payment" /></AppScreen>;
  const item = payment.data;
  const canVoid = me.data?.permissions.includes('payment.void') ?? false;

  const receiptParams = (resolvedPaymentId: string) => ({
    paymentId: resolvedPaymentId,
    ...(appointmentId ? { appointmentId } : {}),
    ...(visitId ? { visitId } : {}),
  });

  async function confirmCash() {
    try {
      const result = await confirmPayment({
        paymentId,
        paymentMethod: 'CASH',
        idempotencyKey: cashRequest.getKey(),
        appointmentId,
        visitId,
      }).unwrap();
      router.replace({ pathname: '/assistant/payments/receipt', params: receiptParams(result.payment.payment_id) });
    } catch {
      // The current request error is rendered below.
    }
  }

  async function doVoid() {
    if (voidReason.trim().length < 2) return;
    try {
      const result = await voidPayment({
        paymentId,
        reason: voidReason.trim(),
        createReplacementPayment: replace,
        idempotencyKey: voidRequest.getKey(),
      }).unwrap();
      setShowVoid(false);
      if (result.replacement) {
        router.replace({
          pathname: '/assistant/payments/[paymentId]',
          params: {
            paymentId: result.replacement.payment_id,
            ...(appointmentId ? { appointmentId } : {}),
            ...(visitId ? { visitId } : {}),
          },
        });
      }
    } catch {
      // The current request error is rendered below.
    }
  }

  const confirmError = cashRequest.resultMatchesIntent ? apiError(confirmState.error) : null;
  const voidError = voidRequest.resultMatchesIntent ? apiError(voidState.error) : null;

  return <KeyboardSafeFormScreen>
    <QueryState query={payment} label="payment" /><BackButton />
    <View style={styles.headingRow}><View style={styles.headingCopy}><Text style={styles.title}>{item.patient_name}</Text><Text style={styles.subtitle}>₹{item.amount_due} · {item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular consultation'}</Text></View><View style={[styles.statusPill, item.status === 'PENDING' && styles.pendingPill, item.status === 'VOID' && styles.voidPill]}><Text style={[styles.statusText, item.status === 'PENDING' && styles.pendingText, item.status === 'VOID' && styles.voidText]}>{paymentStatus(item.status)}</Text></View></View>
    <View style={styles.card}><Row label="Patient ID" value={item.patient_code} /><Row label="Visit date" value={formatClinicDate(item.visit_date)} /><Row label="Amount due" value={`₹${item.amount_due}`} />{item.amount_paid != null ? <Row label="Amount paid" value={`₹${item.amount_paid}`} /> : null}{item.payment_method ? <Row label="Method" value={paymentMethod(item.payment_method)} /> : null}{item.receipt_number ? <Row label="Receipt" value={item.receipt_number} /> : null}{item.void_reason ? <Row label="Void reason" value={item.void_reason} /> : null}</View>
    {item.status === 'PENDING' ? <View style={styles.actions}><AppButton style={styles.flexButton} label={`Confirm ₹${item.amount_due} cash`} loading={confirmState.isLoading} onPress={() => void confirmCash()} /><AppButton style={styles.flexButton} label="Pay by UPI" tone="secondary" onPress={() => router.push({ pathname: '/assistant/payments/upi', params: { paymentId, ...(appointmentId ? { appointmentId } : {}), ...(visitId ? { visitId } : {}) } })} /></View> : null}
    {item.status === 'CONFIRMED' && item.receipt_number ? <AppButton label="View receipt" onPress={() => router.push({ pathname: '/assistant/payments/receipt', params: receiptParams(paymentId) })} /> : null}
    {item.status === 'CONFIRMED' && canVoid ? <AppButton compact label={showVoid ? 'Hide correction' : 'Void payment'} tone="danger" onPress={() => { voidRequest.reset(); setShowVoid(value => !value); }} /> : null}
    {showVoid ? <View style={styles.correctionCard}><Text style={styles.cardTitle}>Financial correction</Text><Text style={styles.warning}>The original payment and receipt stay in history.</Text><KeyboardSafeTextInput value={voidReason} onChangeText={setVoidReason} placeholder="Reason for void" style={styles.input} /><AppButton compact label={replace ? 'Replacement payment: yes' : 'Replacement payment: no'} tone="secondary" onPress={() => setReplace(value => !value)} /><AppButton label="Confirm void" tone="danger" loading={voidState.isLoading} disabled={voidReason.trim().length < 2} onPress={() => void doVoid()} /></View> : null}
    {confirmError ? <Text style={styles.error}>{confirmError.message ?? 'Unable to confirm payment.'}</Text> : null}
    {voidError ? <Text style={styles.error}>{voidError.message ?? 'Unable to void payment.'}</Text> : null}
  </KeyboardSafeFormScreen>;
}

function Row({ label, value }: { label: string; value: string }) { return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>; }
const styles = StyleSheet.create({ headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, headingCopy: { flex: 1, gap: 3 }, title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark }, subtitle: { color: colors.muted, fontSize: 13 }, statusPill: { backgroundColor: colors.softSuccess, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }, statusText: { color: colors.success, fontWeight: '700', fontSize: 11 }, pendingPill: { backgroundColor: colors.softWarning }, pendingText: { color: colors.warning }, voidPill: { backgroundColor: colors.softDanger }, voidText: { color: colors.danger }, card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md }, correctionCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#F0C5C5', borderRadius: radius.lg, padding: spacing.md, gap: spacing.md }, cardTitle: { fontWeight: '800', color: colors.primaryDark }, warning: { color: colors.warning, fontSize: 13, lineHeight: 18 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }, label: { color: colors.muted, fontSize: 13 }, value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right', fontSize: 13 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, flexButton: { flexGrow: 1, flexBasis: '46%' }, input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: colors.background }, error: { color: colors.danger } });
