import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import {
  useBlockScheduleExceptionMutation,
  useClinicTimeQuery,
  useGetAvailabilityQuery,
  useListDoctorsQuery,
} from '@/api/api';
import { apiError } from '@/api/errors';
import { AppButton } from '@/components/AppButton';
import { AppScreen } from '@/components/AppScreen';
import { BackButton } from '@/components/BackButton';
import { DatePicker } from '@/components/DatePicker';
import { FormField } from '@/components/FormField';
import { colors, radius, spacing } from '@/theme/tokens';

export default function BlockDateScreen() {
  const router = useRouter();
  const clinicTime = useClinicTimeQuery();
  const today = clinicTime.data?.clinic_date ?? '';
  const doctors = useListDoctorsQuery();
  const doctorId = doctors.data?.[0]?.doctor_id ?? '';

  const [customDate, setCustomDate] = useState<string | null>(null);
  const date = customDate ?? today;
  const [scope, setScope] = useState<'FULL_DAY' | 'SESSION'>('FULL_DAY');
  const [selectedSessionDefId, setSelectedSessionDefId] = useState<string | null>(null);
  const [reason, setReason] = useState('Doctor unavailable');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [blockException, blockState] = useBlockScheduleExceptionMutation();

  const availabilityQuery = useGetAvailabilityQuery(
    { doctorId, date },
    { skip: !doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(date) }
  );

  const sessions = availabilityQuery.data?.sessions ?? [];
  const hasSessions = sessions.length > 0;

  const effectiveSessionDefId =
    selectedSessionDefId ?? (sessions.length > 0 ? sessions[0].session_definition_id : null);

  // Calculate booked appointments count for the warning
  const bookedAppointmentsCount = (() => {
    if (!hasSessions) return 0;
    if (scope === 'FULL_DAY') {
      return sessions.reduce((acc, s) => acc + (s.used_capacity || 0), 0);
    }
    const currentSession = sessions.find((s) => s.session_definition_id === effectiveSessionDefId);
    return currentSession?.used_capacity ?? 0;
  })();

  const isAlreadyBlocked = (() => {
    if (!hasSessions) return false;
    if (scope === 'FULL_DAY') {
      return sessions.every((s) => s.status === 'BLOCKED');
    }
    const currentSession = sessions.find((s) => s.session_definition_id === effectiveSessionDefId);
    return currentSession?.status === 'BLOCKED';
  })();

  async function handleSave() {
    if (!doctorId || !date) return;
    if (!reason.trim()) {
      setErrorMessage('Please enter a reason for blocking.');
      return;
    }
    if (scope === 'SESSION' && !effectiveSessionDefId) {
      setErrorMessage('Please select a session to block.');
      return;
    }
    if (!hasSessions) {
      setErrorMessage('No active sessions are configured for this doctor on this date.');
      return;
    }

    try {
      setErrorMessage(null);
      await blockException({
        doctorId,
        body: {
          date,
          scope,
          session_definition_id: scope === 'SESSION' ? effectiveSessionDefId : null,
          reason: reason.trim(),
        },
      }).unwrap();

      router.back();
    } catch (error) {
      const err = apiError(error);
      if (err?.code === 'DATE_ALREADY_BLOCKED') {
        setErrorMessage('This date is already blocked.');
      } else if (err?.code === 'SESSION_ALREADY_BLOCKED') {
        setErrorMessage('This session is already blocked.');
      } else {
        setErrorMessage(err?.message ?? 'Unable to save blocked date.');
      }
    }
  }

  return (
    <AppScreen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <BackButton />
        <View style={styles.header}>
          <Text style={styles.title}>Block a Date</Text>
          <Text style={styles.subtitle}>
            Prevent new bookings for a full day or specific session without altering past schedules.
          </Text>
        </View>

        <View style={styles.formCard}>
          {/* 1. Date */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Date</Text>
            <DatePicker value={date} onChange={setCustomDate} placeholder="YYYY-MM-DD" />
          </View>

          {/* 2. Scope */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Scope</Text>
            <View style={styles.chipsRow}>
              <Pressable
                onPress={() => setScope('FULL_DAY')}
                style={[styles.scopeChip, scope === 'FULL_DAY' && styles.scopeChipActive]}
              >
                <Text style={scope === 'FULL_DAY' ? styles.chipTextActive : styles.chipText}>
                  Full Day
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setScope('SESSION')}
                style={[styles.scopeChip, scope === 'SESSION' && styles.scopeChipActive]}
              >
                <Text style={scope === 'SESSION' ? styles.chipTextActive : styles.chipText}>
                  Specific Session
                </Text>
              </Pressable>
            </View>
          </View>

          {/* 3. Session Selector (only if Specific Session chosen) */}
          {scope === 'SESSION' && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Select Session</Text>
              {!hasSessions ? (
                <Text style={styles.helperText}>No sessions configured on this date.</Text>
              ) : (
                <View style={styles.chipsRow}>
                  {sessions.map((sess) => {
                    const isSelected = effectiveSessionDefId === sess.session_definition_id;
                    return (
                      <Pressable
                        key={sess.session_definition_id}
                        onPress={() => setSelectedSessionDefId(sess.session_definition_id)}
                        style={[styles.sessionChip, isSelected && styles.scopeChipActive]}
                      >
                        <Text style={isSelected ? styles.chipTextActive : styles.chipText}>
                          {sess.name} ({sess.start_time.slice(0, 5)}–{sess.end_time.slice(0, 5)})
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* 4. Reason */}
          <View style={styles.fieldGroup}>
            <FormField
              label="Reason"
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Doctor unavailable, Medical conference"
            />
          </View>

          {/* Notice if no sessions or already blocked */}
          {!availabilityQuery.isLoading && !hasSessions && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                No working hours are scheduled for this doctor on {date}.
              </Text>
            </View>
          )}

          {isAlreadyBlocked && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                {scope === 'FULL_DAY' ? 'This date is already blocked.' : 'This session is already blocked.'}
              </Text>
            </View>
          )}

          {/* 5. Appointment Warning */}
          {bookedAppointmentsCount > 0 && (
            <View style={styles.warningBox}>
              <Text style={styles.warningTitle}>Existing Bookings Notice</Text>
              <Text style={styles.warningBody}>
                {bookedAppointmentsCount}{' '}
                {bookedAppointmentsCount === 1 ? 'patient is' : 'patients are'} already booked on this date.
                Blocking will prevent new bookings. Existing appointments will remain valid.
              </Text>
            </View>
          )}

          {errorMessage && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {/* 6. Action Buttons */}
          <View style={styles.actionRow}>
            <AppButton
              label="Save Blocked Date"
              tone="primary"
              loading={blockState.isLoading}
              disabled={isAlreadyBlocked || !hasSessions}
              onPress={() => void handleSave()}
            />
            <AppButton
              label="Cancel"
              tone="secondary"
              onPress={() => router.back()}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: { gap: 4, marginBottom: spacing.sm },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  formCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.md,
  },
  fieldGroup: { gap: 4 },
  label: { color: colors.text, fontWeight: '700', fontSize: 14 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  scopeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  sessionChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  scopeChipActive: {
    backgroundColor: colors.softPrimary,
    borderColor: colors.primary,
  },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  helperText: { color: colors.muted, fontSize: 13 },
  infoBox: {
    backgroundColor: '#FFF8E1',
    borderColor: '#FFE082',
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  infoText: { color: '#F57F17', fontSize: 13, fontWeight: '600' },
  warningBox: {
    backgroundColor: colors.softWarning,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
  },
  warningTitle: { color: colors.text, fontWeight: '800', fontSize: 13 },
  warningBody: { color: colors.text, fontSize: 13, lineHeight: 18 },
  errorBox: {
    backgroundColor: '#FFEBEE',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  errorText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  actionRow: { gap: spacing.sm, marginTop: spacing.xs },
});
