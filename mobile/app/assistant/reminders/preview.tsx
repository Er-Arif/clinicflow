import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { useMarkReminderSentMutation, usePrepareReminderMutation } from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import type { PreparedMessage } from '@/features/messaging/types';
import { colors, radius, spacing } from '@/theme/tokens';

export default function MessagePreviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reminderId: string }>();
  const reminderId = String(params.reminderId ?? '');
  const [prepare, prepareState] = usePrepareReminderMutation();
  const [markSent, markSentState] = useMarkReminderSentMutation();
  const [prepared, setPrepared] = useState<PreparedMessage | null>(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reminderId || prepared || prepareState.isLoading) return;
    void prepare({ reminderId }).unwrap().then(setPrepared).catch((e) => setError(apiError(e)?.message ?? 'Unable to prepare message.'));
  }, [reminderId, prepared, prepare, prepareState.isLoading]);

  async function switchLanguage(language: 'EN' | 'HI') {
    setError(null);
    try {
      setPrepared(await prepare({ reminderId, language }).unwrap());
    } catch (e) {
      setError(apiError(e)?.message ?? 'Unable to prepare message.');
    }
  }

  async function openWhatsApp() {
    if (!prepared) return;
    setError(null);
    try {
      await Linking.openURL(prepared.whatsapp_url);
      setOpened(true);
    } catch {
      setError('WhatsApp could not be opened on this device.');
    }
  }

  async function confirmSent() {
    try {
      await markSent(reminderId).unwrap();
      router.replace('/assistant/reminders');
    } catch (e) {
      setError(apiError(e)?.message ?? 'Unable to mark message as sent.');
    }
  }

  return (
    <AppScreen>
      <Text style={styles.title}>WhatsApp Message</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {prepared ? (
        <>
          <Text style={styles.subtitle}>{prepared.reminder.patient_name} · {prepared.reminder.whatsapp_number}</Text>
          <View style={styles.actions}>
            <AppButton label="English" tone={prepared.reminder.language === 'EN' ? 'primary' : 'secondary'} onPress={() => void switchLanguage('EN')} />
            <AppButton label="Hindi" tone={prepared.reminder.language === 'HI' ? 'primary' : 'secondary'} onPress={() => void switchLanguage('HI')} />
          </View>
          <View style={styles.card}><Text style={styles.message}>{prepared.rendered_message}</Text></View>
          <AppButton label="Open WhatsApp" onPress={() => void openWhatsApp()} />
          <AppButton label="Copy Message" tone="secondary" onPress={() => void Clipboard.setStringAsync(prepared.rendered_message)} />
          {opened ? (
            <View style={styles.card}>
              <Text style={styles.question}>Was the message sent?</Text>
              <AppButton label="Mark Sent" loading={markSentState.isLoading} onPress={() => void confirmSent()} />
              <AppButton label="Not Sent" tone="secondary" onPress={() => setOpened(false)} />
            </View>
          ) : null}
        </>
      ) : <Text style={styles.subtitle}>Preparing message…</Text>}
      <AppButton label="Back" tone="secondary" onPress={() => router.back()} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger },
  actions: { gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  message: { color: colors.text, lineHeight: 22 },
  question: { color: colors.text, fontWeight: '800', fontSize: 17 },
});

