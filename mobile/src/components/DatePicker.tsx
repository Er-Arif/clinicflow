import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, radius, spacing } from '@/theme/tokens';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  minimumDate?: Date;
  placeholder?: string;
}

export function DatePicker({ value, onChange, minimumDate, placeholder = 'YYYY-MM-DD' }: DatePickerProps) {
  const [show, setShow] = useState(false);

  const displayDate = value ? value : placeholder;
  const dateObj = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value) : new Date();

  return (
    <View>
      <Pressable style={styles.input} onPress={() => setShow(true)}>
        <Text style={[styles.text, !value && { color: colors.muted }]}>{displayDate}</Text>
      </Pressable>
      {show && (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display="default"
          minimumDate={minimumDate}
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
