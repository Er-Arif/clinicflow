import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useGetAuditEventQuery } from '@/api/api';
import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing } from '@/theme/tokens';

export default function AuditDetailScreen() {
  const router = useRouter();
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const event = useGetAuditEventQuery(auditId);

  return (
    <AppScreen>
      <Text style={styles.link} onPress={() => router.back()}>Back</Text>
      <Text style={styles.title}>Audit Event</Text>
      {event.isLoading ? <ActivityIndicator /> : null}
      {event.data ? (
        <>
          <Row label="Action" value={event.data.action_type} />
          <Row label="When" value={new Date(event.data.occurred_at).toLocaleString()} />
          <Row label="Actor" value={event.data.actor_display_name ?? event.data.actor_type} />
          <Row label="Entity" value={`${event.data.entity_type}${event.data.entity_id ? ` · ${event.data.entity_id}` : ''}`} />
          <Row label="Reason" value={event.data.reason ?? '—'} />
          <Row label="Request ID" value={event.data.request_id} />
          <JsonBlock title="Previous values" value={event.data.previous_values} />
          <JsonBlock title="New values" value={event.data.new_values} />
          <JsonBlock title="Metadata" value={event.data.metadata} />
        </>
      ) : null}
    </AppScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text selectable style={styles.value}>{value}</Text></View>;
}
function JsonBlock({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  return <View style={styles.block}><Text style={styles.label}>{title}</Text><Text selectable style={styles.code}>{value ? JSON.stringify(value, null, 2) : '—'}</Text></View>;
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' }, title: { fontSize: 28, fontWeight: '900', color: colors.text },
  row: { gap: 4 }, label: { color: colors.muted, fontWeight: '800', fontSize: 12, textTransform: 'uppercase' }, value: { color: colors.text, fontWeight: '700' },
  block: { gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }, code: { color: colors.text, fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
});
