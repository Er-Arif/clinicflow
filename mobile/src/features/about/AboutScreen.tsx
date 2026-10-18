import Constants from 'expo-constants';
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useGetSystemInfoQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

type SystemInfoWithUpdates = {
  service: string;
  api_version: string;
  build_commit: string;
  environment: string;
  minimum_mobile_version: string;
  latest_mobile_version?: string | null;
};

type UpdateState = 'idle' | 'checking' | 'available' | 'current' | 'unavailable' | 'error';

export function AboutScreen() {
  const system = useGetSystemInfoQuery();
  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const buildNumber = Constants.expoConfig?.android?.versionCode?.toString() ?? 'unknown';
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  const checkForUpdates = async () => {
    setUpdateState('checking');
    try {
      const result = await system.refetch();
      if ('error' in result && result.error) {
        setUpdateState('error');
        return;
      }
      const info = result.data as SystemInfoWithUpdates | undefined;
      const latest = info?.latest_mobile_version?.trim() || null;
      setLatestVersion(latest);
      if (!latest || appVersion === 'unknown') {
        setUpdateState('unavailable');
      } else {
        setUpdateState(compareVersions(latest, appVersion) > 0 ? 'available' : 'current');
      }
    } catch {
      setUpdateState('error');
    }
  };

  return (
    <AppScreen>
      <BackButton />
      <View style={styles.brandHeader}>
        <Image
          source={require('../../../assets/clinicflow-lockup.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="ClinicFlow"
        />
        <Text style={styles.tagline}>Appointments · Payments · Follow-ups</Text>
      </View>

      <View style={styles.card}>
        <Row label="Mobile version" value={appVersion} />
        <Row label="Android build" value={buildNumber} />
        <Row label="Backend version" value={system.data?.api_version ?? 'Unavailable'} />
        <Row label="Backend commit" value={system.data?.build_commit ?? 'Unavailable'} />
        <Row label="Environment" value={system.data?.environment ?? 'Unavailable'} />
        <Row label="Minimum mobile version" value={system.data?.minimum_mobile_version ?? 'Unavailable'} />
      </View>

      {system.isError ? <Text style={styles.warning}>Backend build information could not be loaded.</Text> : null}
      <UpdateMessage state={updateState} latestVersion={latestVersion} />
      <AppButton
        label={updateState === 'checking' ? 'Checking…' : 'Check for updates'}
        tone="secondary"
        loading={updateState === 'checking'}
        disabled={updateState === 'checking'}
        onPress={() => { void checkForUpdates(); }}
      />
    </AppScreen>
  );
}

function UpdateMessage({ state, latestVersion }: { state: UpdateState; latestVersion: string | null }) {
  if (state === 'idle' || state === 'checking') return null;
  if (state === 'available') {
    return <View style={styles.updateCard}><Text style={styles.updateTitle}>Update available</Text><Text style={styles.updateText}>ClinicFlow {latestVersion} is available. Installation will be enabled when the update delivery service is connected.</Text></View>;
  }
  if (state === 'current') {
    return <View style={styles.updateCard}><Text style={styles.updateTitle}>You’re up to date</Text><Text style={styles.updateText}>This is the latest version reported by ClinicFlow.</Text></View>;
  }
  if (state === 'unavailable') {
    return <View style={styles.updateCard}><Text style={styles.updateTitle}>Update checking isn’t connected yet</Text><Text style={styles.updateText}>This screen is ready for the app update service when delivery is enabled.</Text></View>;
  }
  return <Text style={styles.warning}>Unable to check for updates right now.</Text>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function compareVersions(a: string, b: string) {
  const normalize = (value: string) => value.replace(/^v/i, '').split('-')[0].split('.').map(part => Number(part) || 0);
  const left = normalize(a);
  const right = normalize(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

const styles = StyleSheet.create({
  brandHeader: { alignItems: 'center', marginBottom: spacing.sm, gap: 4 },
  logo: { width: '78%', height: 64, alignSelf: 'center' },
  tagline: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted, flex: 1, fontSize: 13 },
  value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right', fontSize: 13 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  updateCard: { backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 4 },
  updateTitle: { color: colors.primaryDark, fontWeight: '800', fontSize: 14 },
  updateText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
