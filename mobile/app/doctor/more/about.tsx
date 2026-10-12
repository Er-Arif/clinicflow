import Constants from 'expo-constants';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useGetSystemInfoQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { colors, radius, spacing } from '@/theme/tokens';

export default function AboutScreen() {
  const system = useGetSystemInfoQuery();
  const appVersion = Constants.expoConfig?.version ?? 'unknown';
  const buildNumber = Constants.expoConfig?.android?.versionCode?.toString() ?? 'unknown';

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
        <Row
          label="Minimum mobile version"
          value={system.data?.minimum_mobile_version ?? 'Unavailable'}
        />
      </View>
      {system.isError ? (
        <Text style={styles.warning}>Backend build information could not be loaded.</Text>
      ) : null}
      <AppButton label="Refresh" tone="secondary" onPress={() => system.refetch()} />
    </AppScreen>
  );
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
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  brandHeader: { alignItems: 'center', marginBottom: spacing.md, gap: 4 },
  logo: { width: '80%', height: 64, alignSelf: 'center' },
  tagline: { fontSize: 14, color: colors.muted, textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  label: { color: colors.muted, flex: 1 },
  value: { color: colors.text, fontWeight: '700', flex: 1, textAlign: 'right' },
  warning: { color: colors.warning },
});
