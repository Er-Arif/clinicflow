import { QueryState } from '@/components/QueryState';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useListMessageTemplatesQuery, useUpdateMessageTemplateMutation } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

export default function MessageTemplatesScreen() {
  const query = useListMessageTemplatesQuery();
  const [updateTemplate, updateState] = useUpdateMessageTemplateMutation();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const templates = query.data;
    if (!templates) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const item of templates) if (!(item.template_id in next)) next[item.template_id] = item.template_body;
      return next;
    });
  }, [query.data]);

  async function save(templateId: string, version: number, active: boolean) {
    setError(null);
    try {
      await updateTemplate({ templateId, templateBody: drafts[templateId] ?? '', active, expectedVersion: version }).unwrap();
    } catch (e) {
      setError(apiError(e)?.message ?? 'Unable to save template.');
    }
  }

  return (
    <KeyboardSafeFormScreen>
      <BackButton />
      <QueryState query={query} label="message templates" />
      <Text style={styles.title}>Message Templates</Text>
      <Text style={styles.subtitle}>Operational messages only. Do not include diagnosis, medicines, or sensitive clinical information.</Text>
      <View style={styles.helperCard}>
        <Text style={styles.helperTitle}>Available Variables:</Text>
        <Text style={styles.helperText}>
          {'{patient_name}'}, {'{doctor_name}'}, {'{clinic_name}'}, {'{clinic_contact_number}'}, {'{appointment_date}'}, {'{appointment_time}'}, {'{followup_due_date}'}
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {query.data?.map((item) => (
        <View key={item.template_id} style={styles.card}>
          <Text style={styles.heading}>{item.template_type.replaceAll('_', ' ')} · {item.language}</Text>
          <KeyboardSafeTextInput
            multiline
            value={drafts[item.template_id] ?? ''}
            onChangeText={(value) => setDrafts((current) => ({ ...current, [item.template_id]: value }))}
            style={styles.input}
          />
          <AppButton label="Save Template" loading={updateState.isLoading} onPress={() => void save(item.template_id, item.version, item.active)} />
        </View>
      ))}
    </KeyboardSafeFormScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger },
  helperCard: { backgroundColor: colors.softPrimary, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.primary },
  helperTitle: { fontSize: 13, fontWeight: '800', color: colors.primary, marginBottom: 2 },
  helperText: { fontSize: 12, color: colors.text, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  heading: { color: colors.text, fontWeight: '800' },
  input: { minHeight: 150, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, color: colors.text, backgroundColor: colors.background },
});
