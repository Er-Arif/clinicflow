import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { useListMessageTemplatesQuery, useUpdateMessageTemplateMutation } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
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
    <AppScreen>
      <Text style={styles.title}>Message Templates</Text>
      <Text style={styles.subtitle}>Operational messages only. Do not include diagnosis, medicines, or sensitive clinical information.</Text>
      {query.isFetching ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {query.data?.map((item) => (
        <View key={item.template_id} style={styles.card}>
          <Text style={styles.heading}>{item.template_type.replaceAll('_', ' ')} · {item.language}</Text>
          <TextInput
            multiline
            value={drafts[item.template_id] ?? ''}
            onChangeText={(value) => setDrafts((current) => ({ ...current, [item.template_id]: value }))}
            style={styles.input}
          />
          <AppButton label="Save Template" loading={updateState.isLoading} onPress={() => void save(item.template_id, item.version, item.active)} />
        </View>
      ))}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  heading: { color: colors.text, fontWeight: '800' },
  input: { minHeight: 150, textAlignVertical: 'top', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: 12, color: colors.text, backgroundColor: colors.background },
});
