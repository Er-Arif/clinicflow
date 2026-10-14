import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useClinicTimeQuery, useListAuditEventsQuery, useListUsersQuery } from '@/api/api';
import { DatePicker } from '@/components/DatePicker';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

export default function AuditHistoryScreen() {
  const router = useRouter();
  const clock = useClinicTimeQuery();
  const users = useListUsersQuery();
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [entityInput, setEntityInput] = useState('');
  const [actorUserId, setActorUserId] = useState<string | undefined>();
  const [filters, setFilters] = useState<{ from?: string; to?: string; actorUserId?: string; actionType?: string; entityType?: string }>({});
  const events = useListAuditEventsQuery(filters);

  function apply() {
    setFilters({
      ...(fromInput.trim() ? { from: fromInput.trim() } : {}),
      ...(toInput.trim() ? { to: toInput.trim() } : {}),
      ...(actorUserId ? { actorUserId } : {}),
      ...(actionInput.trim() ? { actionType: actionInput.trim() } : {}),
      ...(entityInput.trim() ? { entityType: entityInput.trim() } : {}),
    });
  }

  function today() {
    if (!clock.data?.clinic_date) return;
    setFromInput(clock.data.clinic_date); setToInput(clock.data.clinic_date);
  }

  return (
    <KeyboardSafeFormScreen refreshing={events.isFetching} onRefresh={() => void events.refetch()}>
      <BackButton />
      <Text style={styles.title}>Audit History</Text>
      <Text style={styles.subtitle}>Read-only history of important ClinicFlow actions.</Text>

      <View style={styles.dateRow}>
        <View style={{ flex: 1 }}>
          <DatePicker value={fromInput} onChange={setFromInput} placeholder="From YYYY-MM-DD" />
        </View>
        <View style={{ flex: 1 }}>
          <DatePicker value={toInput} onChange={setToInput} placeholder="To YYYY-MM-DD" />
        </View>
      </View>
      <AppButton label="Use Today" tone="secondary" onPress={today} />
      <KeyboardSafeTextInput style={styles.input} autoCapitalize="characters" placeholder="Action e.g. PAYMENT_CONFIRMED" value={actionInput} onChangeText={setActionInput} />
      <KeyboardSafeTextInput style={styles.input} autoCapitalize="characters" placeholder="Entity e.g. PAYMENT" value={entityInput} onChangeText={setEntityInput} />

      <Text style={styles.heading}>User</Text>
      <View style={styles.chips}>
        <Chip label="All" active={!actorUserId} onPress={() => setActorUserId(undefined)} />
        {users.data?.items.map((user) => <Chip key={user.user_id} label={user.display_name} active={actorUserId === user.user_id} onPress={() => setActorUserId(user.user_id)} />)}
      </View>
      <AppButton label="Apply Filters" onPress={apply} />

      <Text style={styles.heading}>{events.data ? `${events.data.total} events` : 'Events'}</Text>
      {events.isLoading ? <ActivityIndicator /> : null}
      {events.data?.items.map((event) => (
        <Pressable key={event.audit_id} style={styles.card} onPress={() => router.push(`/doctor/more/audit/${event.audit_id}`)}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.action}>{event.action_type}</Text>
              <Text style={styles.subtitle}>{event.entity_type}{event.actor_display_name ? ` · ${event.actor_display_name}` : ` · ${event.actor_type}`}</Text>
            </View>
            <Text style={styles.time}>{new Date(event.occurred_at).toLocaleString()}</Text>
          </View>
        </Pressable>
      ))}
      {!events.isLoading && events.data?.items.length === 0 ? <Text style={styles.subtitle}>No audit events match these filters.</Text> : null}
    </KeyboardSafeFormScreen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  link: { color: colors.primary, fontWeight: '800' }, title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 }, heading: { fontSize: 17, fontWeight: '900', color: colors.text },
  dateRow: { flexDirection: 'row', gap: spacing.sm }, input: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.softPrimary }, chipText: { color: colors.text, fontWeight: '700' }, chipTextActive: { color: colors.primary },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md }, row: { flexDirection: 'row', gap: spacing.sm },
  action: { color: colors.text, fontWeight: '900' }, time: { maxWidth: 115, color: colors.muted, fontSize: 11, textAlign: 'right' },
});


