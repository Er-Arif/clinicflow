import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

export function MetricCard({ label, value, hint, compact = false }: { label: string; value: string | number; hint?: string; compact?: boolean }) {
  return (
    <View style={[styles.card, compact && styles.compactCard]}>
      <Text style={[styles.value, compact && styles.compactValue]}>{value}</Text>
      <Text numberOfLines={compact ? 2 : undefined} style={[styles.label, compact && styles.compactLabel]}>{label}</Text>
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.035,
    shadowRadius: 7,
    elevation: 1,
  },
  compactCard: { flexBasis: '29%', minWidth: 0, paddingHorizontal: 12, paddingVertical: 13, borderRadius: radius.md },
  value: { fontSize: 24, lineHeight: 29, fontWeight: '800', color: colors.primaryDark },
  compactValue: { fontSize: 21, lineHeight: 25 },
  label: { color: colors.text, fontWeight: '600', fontSize: 14 },
  compactLabel: { fontSize: 12, lineHeight: 16 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 16 },
});
