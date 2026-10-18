import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';

export function ClinicHeader({
  title,
  subtitle,
  displayTime,
  compactDate,
}: {
  title: string;
  subtitle?: string;
  displayTime?: string | null;
  compactDate?: string | null;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {displayTime || compactDate ? (
        <View style={styles.clock}>
          {displayTime ? <Text style={styles.time}>{displayTime}</Text> : null}
          {compactDate ? <Text style={styles.date}>{compactDate}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  copy: { flex: 1, gap: 4 },
  title: { fontSize: 27, lineHeight: 32, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  clock: { alignItems: 'flex-end', gap: 2, paddingTop: 2 },
  time: { color: colors.primaryDark, fontSize: 18, lineHeight: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  date: { color: colors.muted, fontSize: 12, fontWeight: '600' },
});
