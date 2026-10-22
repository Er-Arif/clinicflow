import { formatClinicDate } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { useCallback, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useClinicTimeQuery, useListPaymentsQuery } from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

const filters = ['PENDING', 'CONFIRMED', 'TODAY'] as const;
type Filter = (typeof filters)[number];

function humanize(value: string) {
  const normalized = value.replaceAll('_', ' ').trim().toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : value;
}

function methodLabel(value?: string | null) {
  if (!value) return 'Unpaid';
  return value === 'UPI' ? 'UPI' : humanize(value);
}

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

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        router.replace('/assistant/more');
        return true;
      });
      return () => subscription.remove();
    }, [router]),
  );

  return (
    <AppScreen refreshing={payments.isFetching} onRefresh={() => { if (filter !== 'TODAY' || date) void payments.refetch(); else void clinicTime.refetch(); }}>
      <BackButton onPress={() => router.replace('/assistant/more')} />
      <Text style={styles.title}>Payments</Text>
      <Text style={styles.subtitle}>Pending collections and confirmed financial history.</Text>
      <View style={styles.filters}>
        {filters.map((value) => (
          <Pressable key={value} onPress={() => setFilter(value)} style={[styles.filter, filter === value && styles.filterActive]}>
            <Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{value === 'TODAY' ? 'Today' : value === 'PENDING' ? 'Pending' : 'Confirmed'}</Text>
          </Pressable>
        ))}
      </View>

      {filter === 'TODAY' ? <QueryState query={clinicTime} label="clinic date" /> : null}
      <QueryState query={payments} label="payments" hasData={Boolean(payments.currentData)} empty={payments.currentData?.items.length === 0 ? 'No payments for this filter.' : undefined} />
      {payments.currentData?.items.map((item) => (
        <Pressable
          key={item.payment_id}
          onPress={() => router.push({ pathname: '/assistant/payments/[paymentId]', params: { paymentId: item.payment_id } })}
          style={styles.card}
        >
          <View style={styles.row}><Text style={styles.name}>{item.patient_name}</Text><Text style={styles.amount}>₹{item.amount_due}</Text></View>
          <Text style={styles.meta}>{item.patient_code} · {formatClinicDate(item.visit_date)} · {humanize(item.appointment_type)}</Text>
          <View style={styles.row}><Text style={[styles.status, item.status === 'PENDING' ? styles.pending : styles.confirmed]}>{humanize(item.status)}</Text><Text style={styles.meta}>{methodLabel(item.payment_method)}</Text></View>
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
