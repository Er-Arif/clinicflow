import React, { useState } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, radius } from '@/theme/tokens';

interface TimePickerProps {
  value: string; // HH:mm or HH:mm:ss
  onChange: (time: string) => void; // yields HH:mm
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function TimePicker({
  value,
  onChange,
  placeholder = 'HH:mm',
  style,
  disabled = false,
}: TimePickerProps) {
  const [show, setShow] = useState(false);

  // Normalize initial/current value to Date object
  const dateObj = new Date();
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value?.trim() ?? '');
  if (match) {
    dateObj.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
  }

  const displayTime = value ? value.slice(0, 5) : placeholder;

  return (
    <View style={style}>
      <View style={[styles.input, { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 0 }]}>
        <Pressable
          disabled={disabled}
          style={{ flex: 1, paddingHorizontal: 14, minHeight: 48, justifyContent: 'center' }}
          onPress={() => setShow(true)}
        >
          <Text style={[styles.text, !value && { color: colors.muted }]}>{displayTime}</Text>
        </Pressable>
      </View>
      {show && (
        <DateTimePicker
          value={dateObj}
          mode="time"
          is24Hour={true}
          display="default"
          onChange={(event, selectedDate) => {
            if (Platform.OS === 'android') {
              setShow(false);
            }
            if (event.type === 'set' && selectedDate) {
              const hours = String(selectedDate.getHours()).padStart(2, '0');
              const minutes = String(selectedDate.getMinutes()).padStart(2, '0');
              onChange(`${hours}:${minutes}`);
            } else if (event.type === 'dismissed') {
              // Dialog dismissed
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
