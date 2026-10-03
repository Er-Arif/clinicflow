import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

export function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 3,
  },
  value: { fontSize: 23, fontWeight: '900', color: colors.text },
  label: { color: colors.text, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 12 },
});
