import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DatePicker } from '@/components/DatePicker';
import { colors, radius, spacing } from '@/theme/tokens';
import { formatClinicDate, isIsoDate, startOfIsoMonth, startOfIsoWeek } from '@/utils/dates';

export type DateRange = { from: string; to: string };
export type RangePreset = 'Today' | 'Week' | 'Month' | 'Custom';

export function quickRange(preset: Exclude<RangePreset, 'Custom'>, today: string): DateRange {
  return { from: preset === 'Week' ? startOfIsoWeek(today) : preset === 'Month' ? startOfIsoMonth(today) : today, to: today };
}

export function rangeError({ from, to }: DateRange) {
  if (!isIsoDate(from) || !isIsoDate(to)) return 'Choose a start and end date.';
  if (from > to) return 'End date must be on or after start date.';
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) return 'Choose a range of 367 days or fewer.';
  return null;
}

export function useReportRange(today?: string) {
  const [preset, setPreset] = useState<RangePreset>('Today');
  const [custom, setCustom] = useState<DateRange>({ from: '', to: '' });
  const range = preset === 'Custom' ? custom : today ? quickRange(preset, today) : { from: '', to: '' };
  return { range, preset, error: rangeError(range), select: (next: RangePreset) => {
    if (next === 'Custom') setCustom(range);
    setPreset(next);
  }, setCustom };
}

export function DateRangeControls({ today, selection }: { today?: string; selection: ReturnType<typeof useReportRange> }) {
  const { range, preset, select, setCustom, error } = selection;
  return <View style={styles.container}>
    <View style={styles.chips}>
      {(['Today', 'Week', 'Month', 'Custom'] as const).map(label => <Pressable key={label}
        accessibilityRole="button" accessibilityLabel={label === 'Custom' ? 'Custom range' : label}
        accessibilityState={{ selected: preset === label, disabled: !today }} disabled={!today}
        style={[styles.chip, preset === label && styles.selected]} onPress={() => select(label)}>
        <Text style={[styles.chipText, preset === label && styles.selectedText]}>{label}</Text>
      </Pressable>)}
    </View>
    {preset === 'Custom' ? <View style={styles.dates}>
      <View style={styles.field}><Text style={styles.label}>From</Text><DatePicker value={range.from}
        accessibilityLabel="Range start date" onChange={from => setCustom({ ...range, from })} /></View>
      <View style={styles.field}><Text style={styles.label}>To</Text><DatePicker value={range.to}
        accessibilityLabel="Range end date" onChange={to => setCustom({ ...range, to })} /></View>
    </View> : null}
    {today ? <Text accessibilityRole={error ? 'alert' : undefined} style={[styles.range, error && styles.error]}>
      {error ?? `${formatClinicDate(range.from)} – ${formatClinicDate(range.to)}`}
    </Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  selectedText: { color: '#FFFFFF', fontWeight: '800' },
  dates: { flexDirection: 'row', gap: spacing.sm },
  field: { flex: 1, gap: spacing.xs },
  label: { color: colors.text, fontWeight: '600', fontSize: 13 },
  range: { color: colors.muted, fontSize: 12 },
  error: { color: colors.danger },
});
