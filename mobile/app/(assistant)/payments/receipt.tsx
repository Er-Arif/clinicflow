import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useGetReceiptQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function ReceiptScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ paymentId: string }>();
  const paymentId = String(params.paymentId ?? '');
  const receipt = useGetReceiptQuery(paymentId, { skip: !paymentId });

  if (receipt.isLoading) return <AppScreen><ActivityIndicator /></AppScreen>;
  if (!receipt.data) return <AppScreen><Text style={styles.error}>{apiError(receipt.error)?.message ?? 'Receipt not found.'}</Text></AppScreen>;
  const item = receipt.data;

  return (
    <AppScreen>
      <Text style={styles.title}>Digital Receipt</Text>
      {item.voided ? <Text style={styles.voided}>VOIDED PAYMENT · retained for history</Text> : null}
      <View style={styles.card}>
        <Text style={styles.clinic}>{item.clinic_name}</Text>
        <Text style={styles.number}>{item.receipt_number}</Text>
        <Row label="Doctor" value={item.doctor_name} />
        <Row label="Patient" value={item.patient_name} />
        <Row label="Visit date" value={item.visit_date} />
        <Row label="Type" value={item.appointment_type.replace('_', ' ')} />
        <Row label="Amount" value={`₹${item.amount}`} />
        <Row label="Method" value={item.payment_method} />
        <Row label="Issued" value={new Date(item.issued_at).toLocaleString()} />
      </View>
      <AppButton label="Done" onPress={() => router.replace('/(assistant)/payments')} />
    </AppScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  voided: { color: colors.danger, fontWeight: '900' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  clinic: { fontSize: 20, fontWeight: '900', color: colors.text, textAlign: 'center' },
  number: { color: colors.primary, fontWeight: '800', textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted },
  value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right' },
  error: { color: colors.danger },
});
