import { KeyboardSafeTextInput } from '@/components/KeyboardSafeTextInput';
import { KeyboardSafeFormScreen } from '@/components/KeyboardSafeFormScreen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { apiError } from '@/api/errors';
import { useClinicTimeQuery, useGetAvailabilityQuery, useListDoctorsQuery } from '@/api/api';
import { AppButton } from '@/components/AppButton';
import { colors, radius, spacing } from '@/theme/tokens';

export default function AvailabilityScreen() {
  const router = useRouter();
  const clinicTime = useClinicTimeQuery();
  const [date, setDate] = useState('');
  useEffect(() => {
    if (!date && clinicTime.data?.clinic_date) setDate(clinicTime.data.clinic_date);
  }, [clinicTime.data?.clinic_date, date]);
  const doctors = useListDoctorsQuery();
  const [selectedDoctor, setSelectedDoctor] = useState<string | null>(null);
  const doctorId = selectedDoctor ?? doctors.data?.[0]?.doctor_id ?? '';
  const availability = useGetAvailabilityQuery(
    { doctorId, date },
    { skip: !doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(date) },
  );

  return (
    <KeyboardSafeFormScreen>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Availability</Text>
          <Text style={styles.subtitle}>View configured sessions and normal booking slots.</Text>
        </View>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Back</Text></Pressable>
      </View>

      <Text style={styles.label}>Doctor</Text>
      <View style={styles.chips}>
        {doctors.data?.map((doctor) => (
          <Pressable
            key={doctor.doctor_id}
            onPress={() => setSelectedDoctor(doctor.doctor_id)}
            style={[styles.chip, doctorId === doctor.doctor_id && styles.chipActive]}
          >
            <Text style={doctorId === doctor.doctor_id ? styles.chipTextActive : styles.chipText}>
              {doctor.display_name}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Date</Text>
      <KeyboardSafeTextInput
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        autoCapitalize="none"
        style={styles.input}
      />

      {availability.isFetching ? <ActivityIndicator /> : null}
      {availability.error ? (
        <View style={styles.card}>
          <Text style={styles.error}>{apiError(availability.error)?.message ?? 'Unable to load availability.'}</Text>
          <AppButton label="Retry" tone="secondary" onPress={() => void availability.refetch()} />
        </View>
      ) : null}

      {!availability.isFetching && availability.data?.sessions.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No clinic session configured</Text>
          <Text style={styles.subtitle}>There is no active session for this doctor on the selected date.</Text>
        </View>
      ) : null}

      {availability.data?.sessions.map((session) => (
        <View key={session.session_definition_id} style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{session.name}</Text>
              <Text style={styles.subtitle}>
                {shortTime(session.start_time)}–{shortTime(session.end_time)} · {session.slot_interval_minutes} min
              </Text>
            </View>
            <Text style={session.status === 'BLOCKED' ? styles.blocked : styles.available}>
              {session.status === 'BLOCKED' ? 'BLOCKED' : `${session.remaining_capacity} free`}
            </Text>
          </View>
          {session.blocked_reason ? <Text style={styles.error}>{session.blocked_reason}</Text> : null}
          <View style={styles.slots}>
            {session.slots.map((slot) => (
              <View
                key={slot.time}
                style={[styles.slot, !slot.normal_booking_allowed && styles.slotDisabled]}
              >
                <Text style={!slot.normal_booking_allowed ? styles.muted : styles.slotText}>
                  {shortTime(slot.time)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </KeyboardSafeFormScreen>
  );
}

function shortTime(value: string) {
  return value.slice(0, 5);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '700', paddingTop: 6 },
  label: { fontWeight: '700', color: colors.text },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    color: colors.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  chipActive: { backgroundColor: colors.softPrimary, borderColor: colors.primary },
  chipText: { color: colors.text },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  available: { color: colors.success, fontWeight: '800' },
  blocked: { color: colors.danger, fontWeight: '800' },
  error: { color: colors.danger },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  slot: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8 },
  slotDisabled: { opacity: 0.45 },
  slotText: { color: colors.text, fontWeight: '600' },
  muted: { color: colors.muted },
});
