import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { colors, radius, spacing } from '@/theme/tokens';

type Props = {
  visible: boolean;
  patientName: string;
  dueDate: string;
  selectedReason: string;
  note: string;
  error?: string | null;
  loading?: boolean;
  onReasonChange: (reason: string) => void;
  onNoteChange: (note: string) => void;
  onConfirm: () => void;
  onClose: () => void;
};

const REASONS = [
  { value: 'PATIENT_DECLINED', label: 'Patient declined' },
  { value: 'NO_LONGER_REQUIRED', label: 'No longer required' },
  { value: 'CONTACTED', label: 'Contacted, resolved' },
  { value: 'OTHER', label: 'Other' },
] as const;

export function FollowUpCloseModal({
  visible,
  patientName,
  dueDate,
  selectedReason,
  note,
  error,
  loading,
  onReasonChange,
  onNoteChange,
  onConfirm,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss follow-up closure"
          style={styles.backdrop}
          onPress={onClose}
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Close follow-up</Text>
              <Text style={styles.context}>{patientName} · Due {dueDate}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close follow-up closure"
              hitSlop={10}
              onPress={onClose}
              style={styles.closeIcon}
            >
              <Text style={styles.closeIconText}>×</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.notice}>
              <Text style={styles.noticeText}>Closing removes this follow-up from active queues and stops follow-up reminders.</Text>
            </View>

            <Text style={styles.sectionLabel}>Reason</Text>
            <View style={styles.reasonGrid}>
              {REASONS.map(({ value, label }) => (
                <AppButton
                  key={value}
                  compact
                  label={label}
                  tone={selectedReason === value ? 'primary' : 'secondary'}
                  onPress={() => onReasonChange(value)}
                  style={styles.reasonButton}
                />
              ))}
            </View>

            {selectedReason === 'OTHER' ? (
              <KeyboardSafeTextInput
                value={note}
                onChangeText={onNoteChange}
                placeholder="Reason"
                style={styles.input}
                maxLength={500}
              />
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <AppButton
              label="Close follow-up"
              tone="danger"
              loading={loading}
              disabled={selectedReason === 'OTHER' && note.trim().length < 2}
              onPress={onConfirm}
            />
            <AppButton label="Keep open" tone="secondary" onPress={onClose} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(10,45,98,0.28)', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    maxHeight: '82%',
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerCopy: { flex: 1, gap: 4 },
  title: { color: colors.primaryDark, fontSize: 22, fontWeight: '800' },
  context: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  closeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeIconText: { color: colors.primaryDark, fontSize: 30, lineHeight: 32, fontWeight: '500', includeFontPadding: false },
  scroll: { flexShrink: 1 },
  content: { gap: spacing.md },
  notice: { backgroundColor: colors.softWarning, borderRadius: radius.md, padding: spacing.sm },
  noticeText: { color: colors.warning, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  sectionLabel: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  reasonButton: { flexGrow: 1, flexBasis: '46%' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
