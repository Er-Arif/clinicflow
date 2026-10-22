import { api } from '@/api/api';

export type DoctorTodayDetailView = 'all' | 'checked_in' | 'upcoming';

export type DoctorTodayDetailItem = {
  appointment_id: string;
  patient_id: string;
  patient_name: string;
  mobile_number: string;
  gender: string;
  age: number | null;
  appointment_time: string | null;
  appointment_type: 'REGULAR' | 'FOLLOW_UP';
  status: 'BOOKED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
};

export type DoctorTodayDetails = {
  date: string;
  view: DoctorTodayDetailView;
  total: number;
  items: DoctorTodayDetailItem[];
};

type AppointmentCompat = {
  appointment_id: string;
  patient: { patient_id: string; full_name: string; mobile_number: string };
  appointment_time: string | null;
  appointment_type: 'REGULAR' | 'FOLLOW_UP';
  status: DoctorTodayDetailItem['status'];
};

type PatientCompat = {
  patient_id: string;
  full_name: string;
  mobile_number: string;
  gender: string;
  age: number;
};

type TodayCompat = {
  upcoming: Array<{
    appointment_id: string;
    patient_id: string;
    patient_name: string;
    appointment_time: string | null;
    appointment_type: 'REGULAR' | 'FOLLOW_UP';
    status: DoctorTodayDetailItem['status'];
  }>;
};

const doctorTodayDetailsApi = api.injectEndpoints({
  endpoints: builder => ({
    getDoctorTodayDetails: builder.query<DoctorTodayDetails, { date: string; view: DoctorTodayDetailView }>({
      async queryFn({ date, view }, _queryApi, _extraOptions, baseQuery) {
        // Prefer the optimized joined endpoint once the backend rollout includes it.
        // The fallback keeps mixed-version staging usable while mobile and backend
        // releases are being validated independently.
        const optimized = await baseQuery({ url: '/api/v1/doctor/today-details', params: { date, view } });
        if (!optimized.error) return { data: optimized.data as DoctorTodayDetails };
        if (optimized.error.status !== 404) return { error: optimized.error };

        let baseItems: Array<{
          appointment_id: string;
          patient_id: string;
          patient_name: string;
          mobile_number: string;
          appointment_time: string | null;
          appointment_type: 'REGULAR' | 'FOLLOW_UP';
          status: DoctorTodayDetailItem['status'];
        }> = [];

        if (view === 'upcoming') {
          const todayResult = await baseQuery({ url: '/api/v1/doctor/today', params: { date } });
          if (todayResult.error) return { error: todayResult.error };
          const today = todayResult.data as TodayCompat;
          baseItems = today.upcoming.map(item => ({ ...item, mobile_number: '' }));
        } else {
          const appointmentsResult = await baseQuery({
            url: '/api/v1/appointments',
            params: { date, limit: 200, ...(view === 'checked_in' ? { status: 'CHECKED_IN' } : {}) },
          });
          if (appointmentsResult.error) return { error: appointmentsResult.error };
          const appointments = (appointmentsResult.data as { items: AppointmentCompat[] }).items;
          baseItems = appointments.map(item => ({
            appointment_id: item.appointment_id,
            patient_id: item.patient.patient_id,
            patient_name: item.patient.full_name,
            mobile_number: item.patient.mobile_number,
            appointment_time: item.appointment_time,
            appointment_type: item.appointment_type,
            status: item.status,
          }));
        }

        const patientIds = [...new Set(baseItems.map(item => item.patient_id))];
        const patientResults = await Promise.all(patientIds.map(async patientId => {
          const result = await baseQuery(`/api/v1/patients/${patientId}`);
          return [patientId, result.error ? null : result.data as PatientCompat] as const;
        }));
        const patients = new Map(patientResults);

        const items = baseItems.map(item => {
          const patient = patients.get(item.patient_id);
          return {
            appointment_id: item.appointment_id,
            patient_id: item.patient_id,
            patient_name: patient?.full_name ?? item.patient_name,
            mobile_number: patient?.mobile_number ?? item.mobile_number,
            gender: patient?.gender ?? '',
            age: patient?.age ?? null,
            appointment_time: item.appointment_time,
            appointment_type: item.appointment_type,
            status: item.status,
          } satisfies DoctorTodayDetailItem;
        });

        return { data: { date, view, total: items.length, items } };
      },
    }),
  }),
  overrideExisting: false,
});

export const { useGetDoctorTodayDetailsQuery } = doctorTodayDetailsApi;
