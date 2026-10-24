import Constants from 'expo-constants';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useGetSystemInfoQuery } from '@/api/api';
import type { SystemInfo } from '@/api/systemEndpoints';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { ClinicFlowLogo } from '@/components/ClinicFlowLogo';
import {
  canRequestPackageInstalls,
  downloadAndInstallUpdate,
  openUnknownSourcesSettings,
} from '@/features/about/updateInstaller';
import { evaluateUpdate } from '@/features/about/updatePolicy';
import { colors, radius, spacing } from '@/theme/tokens';

type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'unavailable'
  | 'permission'
  | 'downloading'
  | 'installing'
  | 'error';

export function AboutScreen() {
  const system = useGetSystemInfoQuery();
  const appVersion = Constants.expoConfig?.version ?? 'Unknown';
  const versionCode = Constants.expoConfig?.android?.versionCode ?? null;
  const buildNumber = versionCode?.toString() ?? 'Unknown';
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [updateInfo, setUpdateInfo] = useState<SystemInfo | null>(null);
  const [mandatory, setMandatory] = useState(false);

  const checkForUpdates = async () => {
    setUpdateState('checking');
    setMandatory(false);
    try {
      const result = await system.refetch();
      if ('error' in result && result.error) {
        setUpdateState('error');
        return;
      }
      const info = result.data;
      setUpdateInfo(info ?? null);
      if (!info || appVersion === 'Unknown') {
        setUpdateState('unavailable');
        return;
      }

      const decision = evaluateUpdate(
        { version: appVersion, versionCode },
        info,
      );
      setMandatory(decision.mandatory);
      if (
        decision.state === 'available'
        && (!info.mobile_apk_url || !info.mobile_apk_sha256)
      ) {
        setUpdateState('unavailable');
        return;
      }
      setUpdateState(decision.state);
    } catch {
      setUpdateState('error');
    }
  };

  const installUpdate = async () => {
    const apkUrl = updateInfo?.mobile_apk_url;
    const sha256 = updateInfo?.mobile_apk_sha256;
    if (!apkUrl || !sha256) {
      setUpdateState('unavailable');
      return;
    }

    try {
      const allowed = await canRequestPackageInstalls();
      if (!allowed) {
        await openUnknownSourcesSettings();
        setUpdateState('permission');
        return;
      }

      setUpdateState('downloading');
      await downloadAndInstallUpdate(apkUrl, sha256);
      setUpdateState('installing');
    } catch {
      setUpdateState('error');
    }
  };

  const latestVersion = updateInfo?.latest_mobile_version?.trim() || null;
  const releaseNotes = updateInfo?.mobile_release_notes?.trim() || null;
  const canInstall = updateState === 'available' || updateState === 'permission';

  return (
    <AppScreen>
      <BackButton />
      <View style={styles.brandHeader}>
        <ClinicFlowLogo />
      </View>

      <View style={styles.card}>
        <Row label="Version" value={appVersion} />
        <Row label="Build" value={buildNumber} />
      </View>

      <UpdateMessage
        state={updateState}
        latestVersion={latestVersion}
        releaseNotes={releaseNotes}
        mandatory={mandatory}
      />
      {canInstall ? (
        <AppButton
          label={updateState === 'permission' ? 'Continue update' : 'Install update'}
          tone="primary"
          onPress={() => { void installUpdate(); }}
        />
      ) : null}
      <AppButton
        label={updateState === 'checking' ? 'Checking…' : 'Check for updates'}
        tone="secondary"
        loading={updateState === 'checking'}
        disabled={updateState === 'checking' || updateState === 'downloading'}
        onPress={() => { void checkForUpdates(); }}
      />
    </AppScreen>
  );
}

function UpdateMessage({
  state,
  latestVersion,
  releaseNotes,
  mandatory,
}: {
  state: UpdateState;
  latestVersion: string | null;
  releaseNotes: string | null;
  mandatory: boolean;
}) {
  if (state === 'idle' || state === 'checking') return null;
  if (state === 'available') {
    return (
      <View style={styles.updateCard}>
        <Text style={styles.updateTitle}>
          {mandatory ? 'Update required' : 'Update available'}
        </Text>
        <Text style={styles.updateText}>ClinicFlow {latestVersion} is available.</Text>
        {releaseNotes ? <Text style={styles.updateText}>{releaseNotes}</Text> : null}
      </View>
    );
  }
  if (state === 'permission') {
    return (
      <View style={styles.updateCard}>
        <Text style={styles.updateTitle}>Allow ClinicFlow updates</Text>
        <Text style={styles.updateText}>
          Enable “Allow from this source” in Android settings, return here, then tap Continue update.
        </Text>
      </View>
    );
  }
  if (state === 'downloading') {
    return (
      <View style={styles.updateCard}>
        <Text style={styles.updateTitle}>Downloading update…</Text>
        <Text style={styles.updateText}>ClinicFlow will verify the APK before Android opens the installer.</Text>
      </View>
    );
  }
  if (state === 'installing') {
    return (
      <View style={styles.updateCard}>
        <Text style={styles.updateTitle}>Android installer opened</Text>
        <Text style={styles.updateText}>Review and confirm the system installation prompt to finish updating ClinicFlow.</Text>
      </View>
    );
  }
  if (state === 'current') {
    return (
      <View style={styles.updateCard}>
        <Text style={styles.updateTitle}>You’re up to date</Text>
        <Text style={styles.updateText}>You’re using the latest available version of ClinicFlow.</Text>
      </View>
    );
  }
  if (state === 'unavailable') {
    return (
      <View style={styles.updateCard}>
        <Text style={styles.updateTitle}>Update information unavailable</Text>
        <Text style={styles.updateText}>Please try again later.</Text>
      </View>
    );
  }
  return <Text style={styles.warning}>Unable to check for or install updates right now.</Text>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brandHeader: { alignItems: 'center', marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted, flex: 1, fontSize: 13 },
  value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right', fontSize: 13 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  updateCard: { backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  updateTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 14 },
  updateText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
