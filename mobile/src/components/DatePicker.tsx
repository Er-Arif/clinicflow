import React, { useState } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, radius } from '@/theme/tokens';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  allowClear?: boolean;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}

export function DatePicker({ value, onChange, minimumDate, maximumDate, allowClear, placeholder = 'YYYY-MM-DD', style }: DatePickerProps) {
  const [show, setShow] = useState(false);

  const displayDate = value ? value : placeholder;
  const dateObj = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value) : new Date();

  return (
    <View style={style}>
      <View style={[styles.input, { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 0 }]}>
        <Pressable style={{ flex: 1, paddingHorizontal: 14, minHeight: 48, justifyContent: 'center' }} onPress={() => setShow(true)}>
          <Text style={[styles.text, !value && { color: colors.muted }]}>{displayDate}</Text>
        </Pressable>
        {allowClear && value ? (
          <Pressable style={{ paddingHorizontal: 14, paddingVertical: 10 }} onPress={() => onChange('')}>
            <Text style={{ color: colors.danger, fontWeight: 'bold' }}>Clear</Text>
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
            if (Platform.OS === 'android') {
              setShow(false);
            }
            if (event.type === 'set' && selectedDate) {
              const yyyy = selectedDate.getFullYear();
              const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
              const dd = String(selectedDate.getDate()).padStart(2, '0');
              onChange(`${yyyy}-${mm}-${dd}`);
            } else if (event.type === 'dismissed') {
              // do nothing
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  text: {
    color: colors.text,
    fontSize: 16,
  },
});
