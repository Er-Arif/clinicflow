import { formatClinicTimestamp, formatClinicDate } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { apiError } from '@/api/errors';
import { useClinicTimeQuery, useGetReceiptQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';
function methodLabel(value: string) { return value === 'UPI' ? 'UPI' : value.charAt(0) + value.slice(1).toLowerCase(); }
export default function ReceiptScreen() {
  const clock = useClinicTimeQuery();
  const router = useRouter();
  const params = useLocalSearchParams<{ paymentId: string; appointmentId?: string; visitId?: string }>();
  const paymentId = String(params.paymentId ?? '');
  const appointmentId = params.appointmentId ? String(params.appointmentId) : undefined;
  const receipt = useGetReceiptQuery(paymentId, { skip: !paymentId });

  function finish() {
    if (appointmentId) {
      router.push({
        pathname: '/assistant/appointments/[appointmentId]',
        params: { appointmentId, returnToAppointments: '1' },
      });
      return;
    }
    router.replace('/assistant/payments');
  }

  if (receipt.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!receipt.data) return <AppScreen><BackButton /><Text style={styles.error}>{apiError(receipt.error)?.message ?? 'Receipt not found.'}</Text><QueryState query={receipt} label="receipt" /></AppScreen>;
  const item = receipt.data;
  return <AppScreen><BackButton /><Text style={styles.title}>Receipt</Text><QueryState query={clock} label="clinic time" />{item.voided ? <View style={styles.voidBadge}><Text style={styles.voidText}>Voided</Text></View> : null}<View style={styles.card}><View style={styles.receiptHeader}><Text style={styles.clinic}>{item.clinic_name}</Text><Text style={styles.number}>{item.receipt_number}</Text></View><View style={styles.divider} /><Row label="Patient" value={item.patient_name} /><Row label="Doctor" value={item.doctor_name} /><Row label="Visit date" value={formatClinicDate(item.visit_date)} /><Row label="Type" value={item.appointment_type === 'FOLLOW_UP' ? 'Follow-up' : 'Regular consultation'} /><View style={styles.divider} /><Row label="Amount" value={`₹${item.amount}`} strong /><Row label="Method" value={methodLabel(item.payment_method)} /><Row label="Issued" value={formatClinicTimestamp(item.issued_at, clock.data?.timezone)} /></View><AppButton label="Done" onPress={finish} /></AppScreen>;
}
function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={[styles.value, strong && styles.strong]}>{value}</Text></View>; }
const styles = StyleSheet.create({ title: { fontSize: 27, fontWeight: '800', color: colors.primaryDark }, voidBadge: { alignSelf: 'flex-start', backgroundColor: colors.softDanger, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }, voidText: { color: colors.danger, fontWeight: '700', fontSize: 12 }, card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md }, receiptHeader: { alignItems: 'center', gap: 4 }, clinic: { fontSize: 20, fontWeight: '800', color: colors.primaryDark, textAlign: 'center' }, number: { color: colors.primary, fontWeight: '700', textAlign: 'center', fontSize: 13 }, divider: { height: 1, backgroundColor: colors.border }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }, label: { color: colors.muted, fontSize: 13 }, value: { color: colors.text, fontWeight: '600', flex: 1, textAlign: 'right', fontSize: 13 }, strong: { color: colors.primaryDark, fontWeight: '800', fontSize: 17 }, error: { color: colors.danger } });
