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
        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
        {subtitle ? <Text numberOfLines={1} ellipsizeMode="tail" style={styles.subtitle}>{subtitle}</Text> : null}
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 25, lineHeight: 30, fontWeight: '800', color: colors.primaryDark },
  subtitle: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  clock: { minWidth: 92, alignItems: 'flex-end', gap: 1, paddingTop: 1 },
  time: { color: colors.primaryDark, fontSize: 17, lineHeight: 21, fontWeight: '800', fontVariant: ['tabular-nums'] },
  date: { color: colors.muted, fontSize: 11, lineHeight: 15, fontWeight: '600' },
});
