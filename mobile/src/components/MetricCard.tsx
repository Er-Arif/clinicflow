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
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 9,
    elevation: 1,
  },
  value: { fontSize: 24, lineHeight: 29, fontWeight: '800', color: colors.primaryDark },
  label: { color: colors.text, fontWeight: '600', fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 16 },
});
