import { z } from 'zod';

export const patientFormSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Enter the patient name.').max(160),
    mobile: z.string().trim().min(10, 'Enter a valid mobile number.'),
    whatsappSame: z.boolean(),
    whatsapp: z.string().trim(),
    ageMode: z.enum(['DOB', 'AGE']),
    dateOfBirth: z.string().trim(),
    approximateAge: z.string().trim(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']),
    language: z.enum(['EN', 'HI']),
    remindersEnabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (!value.whatsappSame && value.whatsapp.length < 10) {
      ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Enter the WhatsApp number.' });
    }
    if (value.ageMode === 'DOB') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value.dateOfBirth)) {
        ctx.addIssue({
          code: 'custom',
          path: ['dateOfBirth'],
          message: 'Use YYYY-MM-DD.',
        });
      } else {
        const d = new Date(`${value.dateOfBirth}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) {
          ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Enter a valid date.' });
        } else if (d > new Date()) {
          ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Date of birth cannot be in the future.' });
        }
      }
    } else {
      const age = Number(value.approximateAge);
      if (!Number.isInteger(age) || age < 0 || age > 130) {
        ctx.addIssue({
          code: 'custom',
          path: ['approximateAge'],
          message: 'Enter an age from 0 to 130.',
        });
      }
    }
  });

export type PatientFormValues = z.infer<typeof patientFormSchema>;

export const patientFormDefaults: PatientFormValues = {
  fullName: '',
  mobile: '',
  whatsappSame: true,
  whatsapp: '',
  ageMode: 'AGE',
  dateOfBirth: '',
  approximateAge: '',
  gender: 'MALE',
  language: 'EN',
  remindersEnabled: true,
};
