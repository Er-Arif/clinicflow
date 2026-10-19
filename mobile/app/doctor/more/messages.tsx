import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { useListMessageTemplatesQuery, useUpdateMessageTemplateMutation } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import type { MessageTemplate } from '@/features/messaging/types';
import { colors, radius, spacing } from '@/theme/tokens';

const typeLabels: Record<MessageTemplate['template_type'], string> = {
  APPOINTMENT_CONFIRMATION: 'Appointment confirmation',
  APPOINTMENT_REMINDER: 'Appointment reminder',
  APPOINTMENT_CANCELLED: 'Appointment cancelled',
  APPOINTMENT_RESCHEDULED: 'Appointment rescheduled',
  FOLLOWUP_REMINDER: 'Follow-up reminder',
};

const languageLabels: Record<MessageTemplate['language'], string> = {
  EN: 'English',
  HI: 'Hindi',
};

const commonVariables = ['{patient_name}', '{doctor_name}', '{clinic_name}', '{clinic_contact_number}'];

function variablesFor(type: MessageTemplate['template_type']) {
  return type === 'FOLLOWUP_REMINDER'
    ? [...commonVariables, '{followup_due_date}']
    : [...commonVariables, '{appointment_date}', '{appointment_time}'];
}

export default function MessageTemplatesScreen() {
  const query = useListMessageTemplatesQuery();
  const [updateTemplate, updateState] = useUpdateMessageTemplateMutation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [activeDrafts, setActiveDrafts] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const templates = query.data;
    if (!templates) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const item of templates) if (!(item.template_id in next)) next[item.template_id] = item.template_body;
      return next;
    });
    setActiveDrafts((current) => {
      const next = { ...current };
      for (const item of templates) next[item.template_id] = item.active;
      return next;
    });
  }, [query.data]);

  const groups = useMemo(() => {
    const templates = query.data ?? [];
    return Object.entries(typeLabels)
      .map(([type, label]) => ({
        type: type as MessageTemplate['template_type'],
        label,
        templates: templates
          .filter(item => item.template_type === type)
          .sort((a, b) => a.language.localeCompare(b.language)),
      }))
      .filter(group => group.templates.length > 0);
  }, [query.data]);

  async function save(item: MessageTemplate) {
    setError(null);
    setSavedId(null);
    setSavingId(item.template_id);
    try {
      await updateTemplate({
        templateId: item.template_id,
        templateBody: drafts[item.template_id] ?? '',
        active: activeDrafts[item.template_id] ?? item.active,
        expectedVersion: item.version,
      }).unwrap();
      setSavedId(item.template_id);
      setEditingId(null);
    } catch (e) {
      setError(apiError(e)?.message ?? 'Unable to save template.');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <QueryState query={query} label="message templates" />
      <Text style={styles.title}>Message templates</Text>
      <Text style={styles.subtitle}>Edit the WhatsApp messages used for appointments and follow-ups.</Text>

      <View style={styles.safetyCard}>
        <Text style={styles.safetyTitle}>Keep messages operational</Text>
        <Text style={styles.safetyText}>Do not include diagnosis, medicines, or other sensitive clinical information.</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {groups.map(group => (
        <View key={group.type} style={styles.groupCard}>
          <Text style={styles.groupTitle}>{group.label}</Text>
          {group.templates.map(item => {
            const editing = editingId === item.template_id;
            const saved = savedId === item.template_id;
            const activeDraft = activeDrafts[item.template_id] ?? item.active;
            const availableVariables = variablesFor(item.template_type);
            return (
              <View key={item.template_id} style={styles.templateBlock}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: editing }}
                  style={({ pressed }) => [styles.templateRow, pressed && styles.pressed]}
                  onPress={() => {
                    setError(null);
                    setSavedId(null);
                    setActiveDrafts(current => ({ ...current, [item.template_id]: item.active }));
                    setEditingId(current => current === item.template_id ? null : item.template_id);
                  }}
                >
                  <View style={styles.rowCopy}>
                    <Text style={styles.language}>{languageLabels[item.language]}</Text>
                    <Text style={[styles.status, !item.active && styles.inactive]}>{item.active ? 'Active' : 'Inactive'}</Text>
                  </View>
                  <Text style={styles.actionText}>{editing ? 'Close' : 'Edit'}</Text>
                </Pressable>

                {saved ? <Text style={styles.saved}>Template saved.</Text> : null}

                {editing ? (
                  <View style={styles.editor}>
                    <KeyboardSafeTextInput
                      multiline
                      autoCorrect={false}
                      spellCheck={false}
                      value={drafts[item.template_id] ?? ''}
                      onChangeText={(value) => setDrafts((current) => ({ ...current, [item.template_id]: value }))}
                      style={styles.input}
                    />

                    <View style={styles.toggleRow}>
                      <View style={styles.toggleCopy}>
                        <Text style={styles.toggleTitle}>Template enabled</Text>
                        <Text style={styles.toggleHint}>{activeDraft ? 'This template can be used for outgoing messages.' : 'This template will not be used for outgoing messages.'}</Text>
                      </View>
                      <Switch
                        value={activeDraft}
                        onValueChange={value => setActiveDrafts(current => ({ ...current, [item.template_id]: value }))}
                      />
                    </View>

                    <View style={styles.variablesCard}>
                      <Text style={styles.variablesTitle}>Available variables</Text>
                      <Text style={styles.variablesText}>{availableVariables.join('  ')}</Text>
                    </View>
                    <AppButton
                      compact
                      label="Save template"
                      loading={updateState.isLoading && savingId === item.template_id}
                      disabled={!drafts[item.template_id]?.trim() || (updateState.isLoading && savingId !== item.template_id)}
                      onPress={() => void save(item)}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger, fontWeight: '600' },
  safetyCard: { backgroundColor: colors.surfaceSoft, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: 3 },
  safetyTitle: { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
  safetyText: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  groupCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  groupTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 15, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm },
  templateBlock: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  templateRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surfaceSoft },
  rowCopy: { gap: 2 },
  language: { color: colors.text, fontSize: 14, fontWeight: '700' },
  status: { color: colors.success, fontSize: 11, fontWeight: '700' },
  inactive: { color: colors.muted },
  actionText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  editor: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface },
  input: { minHeight: 160, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, color: colors.text, backgroundColor: colors.background },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  toggleCopy: { flex: 1, gap: 2 },
  toggleTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  toggleHint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  variablesCard: { backgroundColor: colors.softPrimary, borderRadius: radius.sm, padding: spacing.sm, gap: 3 },
  variablesTitle: { fontSize: 12, fontWeight: '800', color: colors.primaryDark },
  variablesText: { fontSize: 11, color: colors.text, lineHeight: 17 },
  saved: { color: colors.success, fontSize: 12, fontWeight: '700', paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  pressed: { opacity: 0.72 },
});
