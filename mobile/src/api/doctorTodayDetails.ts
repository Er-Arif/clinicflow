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

const doctorTodayDetailsApi = api.injectEndpoints({
  endpoints: builder => ({
    getDoctorTodayDetails: builder.query<DoctorTodayDetails, { date: string; view: DoctorTodayDetailView }>({
      query: ({ date, view }) => ({
        url: '/api/v1/doctor/today-details',
        params: { date, view },
      }),
    }),
  }),
  overrideExisting: false,
});

export const { useGetDoctorTodayDetailsQuery } = doctorTodayDetailsApi;
