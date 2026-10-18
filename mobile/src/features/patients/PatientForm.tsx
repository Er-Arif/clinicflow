import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { DatePicker } from '@/components/DatePicker';
import { FormField } from '@/components/FormField';
import { PatientFormValues, patientFormSchema } from '@/features/patients/form';
import { colors, radius, spacing } from '@/theme/tokens';

type Props = {
  initialValues: PatientFormValues;
  submitLabel: string;
  loading?: boolean;
  onSubmit: (values: PatientFormValues) => void;
};

export function PatientForm({ initialValues, submitLabel, loading, onSubmit }: Props) {
  const {
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<PatientFormValues>({ defaultValues: initialValues });
  const whatsappSame = watch('whatsappSame');
  const mobile = watch('mobile');
  const whatsapp = watch('whatsapp');
  const ageMode = watch('ageMode');
  const hasMobile = mobile.trim().length > 0;
  const whatsappSameEffective = hasMobile && whatsappSame;
  const hasSeparateWhatsApp = !whatsappSame && whatsapp.trim().length >= 10;
  const hasMessagingContact = whatsappSameEffective || hasSeparateWhatsApp;

  const validateAndSubmit = handleSubmit((values) => {
    const result = patientFormSchema.safeParse(values);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path[0] as keyof PatientFormValues | undefined;
        if (path) setError(path, { message: issue.message });
      }
      return;
    }
    onSubmit(result.data);
  });

  return (
    <View style={styles.form}>
      <Controller
        control={control}
        name="fullName"
        render={({ field }) => (
          <FormField
            label="Full name"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={errors.fullName?.message}
            autoCapitalize="words"
          />
        )}
      />
      <Controller
        control={control}
        name="mobile"
        render={({ field }) => (
          <FormField
            label="Mobile number (optional)"
            value={field.value}
            onBlur={field.onBlur}
            onChangeText={field.onChange}
            error={errors.mobile?.message}
            keyboardType="phone-pad"
          />
        )}
      />

      <Controller
        control={control}
        name="whatsappSame"
        render={({ field }) => (
          <ToggleRow
            label="WhatsApp on same number"
            value={hasMobile && field.value}
            onChange={field.onChange}
            disabled={!hasMobile}
          />
        )}
      />
      {!whatsappSame ? (
        <Controller
          control={control}
          name="whatsapp"
          render={({ field }) => (
            <FormField
              label="WhatsApp number (optional)"
              value={field.value}
              onChangeText={field.onChange}
              error={errors.whatsapp?.message}
              keyboardType="phone-pad"
            />
          )}
        />
      ) : null}

      <Text style={styles.sectionLabel}>Age information</Text>
      <Controller
        control={control}
        name="ageMode"
        render={({ field }) => (
          <ChoiceRow
            value={field.value}
            onChange={field.onChange}
            options={[
              ['DOB', 'Date of birth'],
              ['AGE', 'Approx. age'],
            ]}
          />
        )}
      />
      {ageMode === 'DOB' ? (
        <Controller
          control={control}
          name="dateOfBirth"
          render={({ field }) => (
            <View style={{ marginBottom: spacing.md }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: spacing.xs }}>
                Date of birth
              </Text>
              <DatePicker
                value={field.value ?? ''}
                onChange={field.onChange}
                placeholder="YYYY-MM-DD"
                maximumDate={new Date()}
                allowClear
              />
              {errors.dateOfBirth?.message ? (
                <Text style={{ color: colors.danger, fontSize: 12, marginTop: spacing.xs }}>
                  {errors.dateOfBirth.message}
                </Text>
              ) : null}
            </View>
          )}
        />
      ) : (
        <Controller
          control={control}
          name="approximateAge"
          render={({ field }) => (
            <FormField
              label="Approximate age"
              value={field.value}
              onChangeText={field.onChange}
              error={errors.approximateAge?.message}
              keyboardType="number-pad"
            />
          )}
        />
      )}

      <Text style={styles.sectionLabel}>Gender</Text>
      <Controller
        control={control}
        name="gender"
        render={({ field }) => (
          <ChoiceRow
            value={field.value}
            onChange={field.onChange}
            options={[
              ['MALE', 'Male'],
              ['FEMALE', 'Female'],
            ]}
          />
        )}
      />
      {errors.gender?.message ? <Text style={styles.errorText}>{errors.gender.message}</Text> : null}

      <Text style={styles.sectionLabel}>Preferred message language</Text>
      <Controller
        control={control}
        name="language"
        render={({ field }) => (
          <ChoiceRow
            value={field.value}
            onChange={field.onChange}
            options={[
              ['EN', 'English'],
              ['HI', 'Hindi'],
            ]}
          />
        )}
      />
      <Controller
        control={control}
        name="remindersEnabled"
        render={({ field }) => (
          <ToggleRow
            label="Receive appointment and reminder messages"
            value={hasMessagingContact && field.value}
            onChange={field.onChange}
            disabled={!hasMessagingContact}
          />
        )}
      />
      <AppButton label={submitLabel} onPress={validateAndSubmit} loading={loading} />
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, disabled && styles.toggleRowDisabled]}>
      <Text style={[styles.toggleLabel, disabled && styles.toggleLabelDisabled]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

function ChoiceRow<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly (readonly [T, string])[];
}) {
  return (
    <View style={styles.choices}>
      {options.map(([key, label]) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          style={[styles.choice, value === key && styles.choiceSelected]}
        >
          <Text style={[styles.choiceText, value === key && styles.choiceTextSelected]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  sectionLabel: { color: colors.text, fontSize: 14, fontWeight: '700' },
  toggleRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  toggleRowDisabled: { opacity: 0.65 },
  toggleLabel: { color: colors.text, flex: 1, paddingRight: 12 },
  toggleLabelDisabled: { color: colors.muted },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
  },
  choiceSelected: { backgroundColor: colors.softPrimary, borderColor: colors.primary },
  choiceText: { color: colors.text },
  choiceTextSelected: { color: colors.primary, fontWeight: '700' },
  errorText: { color: colors.danger, fontSize: 12 },
});
