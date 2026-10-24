import { formatClinicTimestamp } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useClinicTimeQuery, useGetAuditEventQuery } from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

function humanizeCode(value: string) {
  const text = value.replaceAll('_', ' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : value;
}

function humanizeKey(value: string) {
  return humanizeCode(value);
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value, null, 2);
}

export default function AuditDetailScreen() {
  const clock = useClinicTimeQuery();
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const event = useGetAuditEventQuery(auditId);

  return (
    <AppScreen>
      <BackButton />
      <Text style={styles.title}>Audit event</Text>
      <Text style={styles.subtitle}>Read-only details for this recorded ClinicFlow action.</Text>
      <QueryState query={clock} label="clinic time" />
      <QueryState query={event} label="audit event" />
      {event.data ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Overview</Text>
            <Row label="Action" value={humanizeCode(event.data.action_type)} />
            <Row label="When" value={formatClinicTimestamp(event.data.occurred_at, clock.data?.timezone)} />
            <Row label="Actor" value={event.data.actor_display_name ?? humanizeCode(event.data.actor_type)} />
            <Row label="Entity" value={humanizeCode(event.data.entity_type)} />
            {event.data.reason ? <Row label="Reason" value={event.data.reason} /> : null}
          </View>

          <Text style={styles.sectionTitle}>Recorded changes</Text>
          <ValuesBlock title="Previous values" value={event.data.previous_values} />
          <ValuesBlock title="New values" value={event.data.new_values} />
          {event.data.metadata && Object.keys(event.data.metadata).length > 0 ? <ValuesBlock title="Metadata" value={event.data.metadata} /> : null}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Technical details</Text>
            <Row label="Entity ID" value={event.data.entity_id ?? '—'} selectable />
            <Row label="Request ID" value={event.data.request_id} selectable />
          </View>
        </>
      ) : null}
    </AppScreen>
  );
}

function Row({ label, value, selectable = false }: { label: string; value: string; selectable?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable={selectable} style={styles.value}>{value}</Text>
    </View>
  );
}

function ValuesBlock({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  const entries = value ? Object.entries(value) : [];
  return (
    <View style={styles.card}>
      <Text style={styles.blockTitle}>{title}</Text>
      {entries.length === 0 ? <Text style={styles.empty}>No values recorded.</Text> : entries.map(([key, item]) => (
        <View key={key} style={styles.changeRow}>
          <Text style={styles.label}>{humanizeKey(key)}</Text>
          <Text selectable style={styles.changeValue}>{displayValue(item)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '900', color: colors.text },
  card: { gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  row: { gap: 4 },
  label: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  value: { color: colors.text, fontWeight: '700', lineHeight: 20 },
  blockTitle: { color: colors.text, fontWeight: '900', fontSize: 15 },
  changeRow: { gap: 5 },
  changeValue: { color: colors.text, lineHeight: 20 },
  empty: { color: colors.muted, lineHeight: 20 },
});
