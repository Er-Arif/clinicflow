import React, { useState } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, radius } from '@/theme/tokens';
import { formatClinicDate, isIsoDate, pickerDate } from '@/utils/dates';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  allowClear?: boolean;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function DatePicker({ value, onChange, minimumDate, maximumDate, allowClear, placeholder = 'Choose date', style, accessibilityLabel = 'Choose date' }: DatePickerProps) {
  const [show, setShow] = useState(false);

  const displayDate = isIsoDate(value) ? formatClinicDate(value) : placeholder;
  const dateObj = isIsoDate(value) ? pickerDate(value) : minimumDate ?? new Date();

  return (
    <View style={style}>
      <View style={styles.input}>
        <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityValue={{ text: displayDate }} style={styles.pressable} onPress={() => setShow(true)}>
          <Text style={[styles.text, !value && styles.placeholder]}>{displayDate}</Text>
        </Pressable>
        {allowClear && value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${accessibilityLabel.toLowerCase()}`} style={styles.clearButton} onPress={() => onChange('')}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {show && (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(event, selectedDate) => {
            if (Platform.OS === 'android') setShow(false);
            if (event.type === 'set' && selectedDate) {
              const yyyy = selectedDate.getFullYear();
              const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
              const dd = String(selectedDate.getDate()).padStart(2, '0');
              onChange(`${yyyy}-${mm}-${dd}`);
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  pressable: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 13 },
  clearButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 13 },
  text: { color: colors.text, fontSize: 14, fontWeight: '500' },
  placeholder: { color: colors.muted, fontWeight: '400' },
  clearText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
});
