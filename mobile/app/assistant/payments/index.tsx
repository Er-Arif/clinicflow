import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useClinicTimeQuery, useListPaymentsQuery } from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

const filters = ['PENDING', 'CONFIRMED', 'TODAY'] as const;
type Filter = (typeof filters)[number];

export default function PaymentsScreen() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('PENDING');
  const clinicTime = useClinicTimeQuery();
  const date = filter === 'TODAY' ? clinicTime.data?.clinic_date : undefined;
  const payments = useListPaymentsQuery(
    {
      ...(filter !== 'TODAY' ? { status: filter } : {}),
      ...(date ? { date } : {}),
    },
    { skip: filter === 'TODAY' && !date },
  );

  return (
    <AppScreen>
      <Text style={styles.title}>Payments</Text>
      <Text style={styles.subtitle}>Pending collections and confirmed financial history.</Text>
      <View style={styles.filters}>
        {filters.map((value) => (
          <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}>
            <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{value === 'TODAY' ? 'Today' : value === 'PENDING' ? 'Pending' : 'Confirmed'}</Text>
          </Pressable>
        ))}
      </View>

      {payments.isLoading || (filter === 'TODAY' && clinicTime.isLoading) ? <ActivityIndicator /> : null}
      {payments.error ? <Text style={styles.error}>{apiError(payments.error)?.message ?? 'Unable to load payments.'}</Text> : null}
      {payments.data?.items.length === 0 ? <Text style={styles.empty}>No payments found.</Text> : null}
      {payments.data?.items.map((item) => (
        <Pressable
          key={item.payment_id}
          onPress={() => router.push({ pathname: '/assistant/payments/[paymentId]', params: { paymentId: item.payment_id } })}
          style={styles.card}
        >
          <View style={styles.row}><Text style={styles.name}>{item.patient_name}</Text><Text style={styles.amount}>₹{item.amount_due}</Text></View>
          <Text style={styles.meta}>{item.patient_code} · {item.visit_date} · {item.appointment_type.replace('_', ' ')}</Text>
          <View style={styles.row}><Text style={[styles.status, item.status === 'PENDING' ? styles.pending : styles.confirmed]}>{item.status}</Text><Text style={styles.meta}>{item.payment_method ?? 'Unpaid'}</Text></View>
        </Pressable>
      ))}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted },
  filters: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  filter: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { color: colors.text, fontWeight: '700' },
  filterTextActive: { color: '#FFFFFF' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  name: { fontSize: 17, fontWeight: '800', color: colors.text, flex: 1 },
  amount: { fontSize: 18, fontWeight: '900', color: colors.text },
  meta: { color: colors.muted },
  status: { fontWeight: '900' },
  pending: { color: colors.warning },
  confirmed: { color: colors.success },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: spacing.xl },
  error: { color: colors.danger },
});

