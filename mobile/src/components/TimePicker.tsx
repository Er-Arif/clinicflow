import React, { useState } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, radius } from '@/theme/tokens';
import { formatClinicTime } from '@/utils/dates';

interface TimePickerProps {
  value: string;
  onChange: (time: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export function TimePicker({
  value,
  onChange,
  placeholder = 'Select time',
  style,
  disabled = false,
  accessibilityLabel,
}: TimePickerProps) {
  const [show, setShow] = useState(false);
  const dateObj = new Date();
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value?.trim() ?? '');
  if (match) dateObj.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);

  return (
    <View style={style}>
      <View style={styles.input}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled }}
          disabled={disabled}
          style={styles.pressable}
          onPress={() => setShow(true)}
        >
          <Text style={[styles.text, !value && styles.placeholder]}>{value ? formatClinicTime(value) : placeholder}</Text>
        </Pressable>
      </View>
      {show ? (
        <DateTimePicker
          value={dateObj}
          mode="time"
          is24Hour={false}
          display="default"
          onChange={(event, selectedDate) => {
            if (Platform.OS === 'android') setShow(false);
            if (event.type === 'set' && selectedDate) {
              const hours = String(selectedDate.getHours()).padStart(2, '0');
              const minutes = String(selectedDate.getMinutes()).padStart(2, '0');
              onChange(`${hours}:${minutes}`);
            }
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, justifyContent: 'center' },
  pressable: { flex: 1, paddingHorizontal: 14, minHeight: 48, justifyContent: 'center' },
  text: { color: colors.text, fontSize: 16 },
  placeholder: { color: colors.muted },
});
