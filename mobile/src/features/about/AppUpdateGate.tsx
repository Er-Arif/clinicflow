import Constants from 'expo-constants';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';

import { useGetSystemInfoQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import {
  canRequestPackageInstalls,
  downloadAndInstallUpdate,
  openUnknownSourcesSettings,
} from '@/features/about/updateInstaller';
import { evaluateUpdate } from '@/features/about/updatePolicy';
import { colors, radius, spacing } from '@/theme/tokens';

type GateState =
  | 'hidden'
  | 'available'
  | 'permission'
  | 'downloading'
  | 'installing'
  | 'error';

export function AppUpdateGate() {
  const { data, isSuccess } = useGetSystemInfoQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });
  const [state, setState] = useState<GateState>('hidden');
  const [dismissed, setDismissed] = useState(false);

  const installedVersion = Constants.expoConfig?.version ?? '';
  const installedVersionCode = Constants.expoConfig?.android?.versionCode ?? null;
  const decision = useMemo(
    () => data
      ? evaluateUpdate(
          { version: installedVersion, versionCode: installedVersionCode },
          data,
        )
      : null,
    [data, installedVersion, installedVersionCode],
  );

  const hasInstallArtifact = Boolean(data?.mobile_apk_url && data?.mobile_apk_sha256);
  const mandatory = decision?.state === 'available' && decision.mandatory;

  useEffect(() => {
    if (
      Platform.OS !== 'android'
      || !isSuccess
      || !decision
      || decision.state !== 'available'
      || !hasInstallArtifact
      || dismissed
    ) {
      return;
    }
    setState((current) => current === 'hidden' ? 'available' : current);
  }, [decision, dismissed, hasInstallArtifact, isSuccess]);

  if (Platform.OS !== 'android' || state === 'hidden' || !data || !decision) {
    return null;
  }

  const install = async () => {
    if (!data.mobile_apk_url || !data.mobile_apk_sha256) {
      setState('error');
      return;
    }

    try {
      const allowed = await canRequestPackageInstalls();
      if (!allowed) {
        await openUnknownSourcesSettings();
        setState('permission');
        return;
      }

      setState('downloading');
      await downloadAndInstallUpdate(data.mobile_apk_url, data.mobile_apk_sha256);
      setState('installing');
    } catch {
      setState('error');
    }
  };

  const closeOptional = () => {
    if (mandatory) return;
    setDismissed(true);
    setState('hidden');
  };

  return (
    <Modal
      visible
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={closeOptional}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>
            {mandatory ? 'ClinicFlow update required' : 'ClinicFlow update available'}
          </Text>
          <Text style={styles.body}>
            {state === 'permission'
              ? 'Enable “Allow from this source” in Android settings, return to ClinicFlow, then continue the update.'
              : state === 'downloading'
                ? 'Downloading and verifying the signed ClinicFlow update…'
                : state === 'installing'
                  ? 'Android’s installer is open. Review and confirm the system prompt to finish updating ClinicFlow.'
                  : state === 'error'
                    ? 'The update could not be prepared. Check your connection and try again.'
                    : `ClinicFlow ${data.latest_mobile_version} is ready to install.`}
          </Text>
          {data.mobile_release_notes.trim() && state === 'available' ? (
            <Text style={styles.notes}>{data.mobile_release_notes.trim()}</Text>
          ) : null}

          {state !== 'installing' ? (
            <AppButton
              label={state === 'permission' ? 'Continue update' : state === 'error' ? 'Retry update' : 'Update ClinicFlow'}
              loading={state === 'downloading'}
              disabled={state === 'downloading'}
              onPress={() => { void install(); }}
            />
          ) : null}
          {!mandatory && state !== 'downloading' && state !== 'installing' ? (
            <AppButton label="Later" tone="secondary" onPress={closeOptional} />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(9, 30, 66, 0.42)',
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 8,
  },
  title: {
    color: colors.primaryDark,
    fontSize: 20,
    fontWeight: '800',
  },
  body: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
  notes: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
});
