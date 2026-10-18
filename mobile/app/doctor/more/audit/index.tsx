import { formatClinicTimestamp } from '@/utils/dates';
import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useClinicTimeQuery, useListAuditEventsQuery, useListUsersQuery } from '@/api/api';
import { DatePicker } from '@/components/DatePicker';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

function humanizeCode(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

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
    setFromInput(clock.data.clinic_date);
    setToInput(clock.data.clinic_date);
  }

  function clear() {
    setFromInput('');
    setToInput('');
    setActionInput('');
    setEntityInput('');
    setActorUserId(undefined);
    setFilters({});
  }

  return (
    <KeyboardSafeFormScreen refreshing={events.isFetching} onRefresh={() => void events.refetch()}>
      <BackButton />
      <Text style={styles.title}>Audit History</Text>
      <Text style={styles.subtitle}>Read-only history of important ClinicFlow activity.</Text>

      <View style={styles.filterCard}>
        <Text style={styles.heading}>Filters</Text>
        <View style={styles.dateRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>From</Text>
            <DatePicker value={fromInput} onChange={setFromInput} placeholder="Select date" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>To</Text>
            <DatePicker value={toInput} onChange={setToInput} placeholder="Select date" />
          </View>
        </View>

        <View style={styles.quickRow}>
          <Pressable onPress={today} hitSlop={8}><Text style={styles.quickAction}>Use today</Text></Pressable>
          <Pressable onPress={clear} hitSlop={8}><Text style={styles.clearAction}>Clear filters</Text></Pressable>
        </View>

        <Text style={styles.fieldLabel}>Action</Text>
        <KeyboardSafeTextInput
          style={styles.input}
          autoCapitalize="characters"
          placeholder="Optional action code"
          value={actionInput}
          onChangeText={setActionInput}
        />
        <Text style={styles.fieldLabel}>Entity</Text>
        <KeyboardSafeTextInput
          style={styles.input}
          autoCapitalize="characters"
          placeholder="Optional entity type"
          value={entityInput}
          onChangeText={setEntityInput}
        />

        <Text style={styles.fieldLabel}>User</Text>
        <View style={styles.chips}>
          <Chip label="All" active={!actorUserId} onPress={() => setActorUserId(undefined)} />
          {users.data?.items.map((user) => (
            <Chip
              key={user.user_id}
              label={user.display_name}
              active={actorUserId === user.user_id}
              onPress={() => setActorUserId(user.user_id)}
            />
          ))}
        </View>
        <AppButton label="Apply filters" onPress={apply} />
      </View>

      <View style={styles.resultsHeader}>
        <Text style={styles.heading}>{events.currentData ? `${events.currentData.total} events` : 'Events'}</Text>
        <Text style={styles.resultsHint}>Newest first</Text>
      </View>
      <QueryState query={events} label="audit events" hasData={Boolean(events.currentData)} empty={events.currentData?.items.length === 0 ? 'No audit events match these filters.' : undefined} />
      {events.currentData?.items.map((event) => (
        <Pressable key={event.audit_id} style={styles.card} onPress={() => router.push(`/doctor/more/audit/${event.audit_id}`)}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.action}>{humanizeCode(event.action_type)}</Text>
              <Text style={styles.meta}>
                {humanizeCode(event.entity_type)}{event.actor_display_name ? ` · ${event.actor_display_name}` : ` · ${humanizeCode(event.actor_type)}`}
              </Text>
            </View>
            <Text style={styles.time}>{formatClinicTimestamp(event.occurred_at, clock.data?.timezone)}</Text>
          </View>
          <Text style={styles.viewLink}>View details ›</Text>
        </Pressable>
      ))}
    </KeyboardSafeFormScreen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}><Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  heading: { fontSize: 17, fontWeight: '900', color: colors.text },
  filterCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  fieldLabel: { color: colors.text, fontWeight: '800', fontSize: 13 },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 },
  quickAction: { color: colors.primary, fontWeight: '800' },
  clearAction: { color: colors.muted, fontWeight: '700' },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.softPrimary },
  chipText: { color: colors.text, fontWeight: '700' },
  chipTextActive: { color: colors.primary },
  resultsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultsHint: { color: colors.muted, fontSize: 12 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, gap: 7 },
  row: { flexDirection: 'row', gap: spacing.sm },
  action: { color: colors.text, fontWeight: '900', fontSize: 15, lineHeight: 20 },
  meta: { color: colors.muted, marginTop: 3, fontSize: 12, lineHeight: 17 },
  time: { maxWidth: 120, color: colors.muted, fontSize: 11, lineHeight: 15, textAlign: 'right' },
  viewLink: { color: colors.primary, fontWeight: '800', fontSize: 12, alignSelf: 'flex-end' },
});
