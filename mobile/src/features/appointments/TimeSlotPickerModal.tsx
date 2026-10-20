import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatClinicTime } from '@/utils/dates';
import { colors, radius, spacing } from '@/theme/tokens';

export type TimeSlotOption = {
  time: string;
  disabled?: boolean;
};

type Props = {
  visible: boolean;
  slots: TimeSlotOption[];
  selectedTime: string;
  onSelect: (time: string) => void;
  onClose: () => void;
};

export function TimeSlotPickerModal({ visible, slots, selectedTime, onSelect, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const bottomClearance = insets.bottom + spacing.lg;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss time picker" style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select time</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close time picker" hitSlop={10} onPress={onClose} style={styles.closeIcon}>
              <Text style={styles.closeIconText}>×</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.slotScroll}
            contentContainerStyle={[styles.slots, { paddingBottom: bottomClearance }]}
            showsVerticalScrollIndicator
          >
            {slots.map((slot) => (
              <Pressable
                key={slot.time}
                disabled={slot.disabled}
                onPress={() => onSelect(slot.time)}
                style={[styles.slot, slot.disabled && styles.slotDisabled, selectedTime === slot.time && styles.slotSelected]}
              >
                <Text style={selectedTime === slot.time ? styles.slotSelectedText : styles.slotText}>{formatClinicTime(slot.time)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(10,45,98,0.28)', justifyContent: 'flex-end' },
  modalBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  modalContent: { backgroundColor: colors.background, padding: spacing.lg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '72%', gap: spacing.md },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  modalTitle: { fontSize: 22, fontWeight: '800', color: colors.primaryDark },
  closeIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSoft, borderWidth: 1, borderColor: colors.border },
  closeIconText: { color: colors.primaryDark, fontSize: 30, lineHeight: 32, fontWeight: '500', includeFontPadding: false },
  slotScroll: { flexShrink: 1 },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  slot: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSoft, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  slotDisabled: { opacity: 0.35 },
  slotSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  slotText: { color: colors.text, fontWeight: '600', fontSize: 12 },
  slotSelectedText: { color: colors.surface, fontWeight: '800', fontSize: 12 },
});
