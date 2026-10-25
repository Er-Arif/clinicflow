import type { EndpointBuilder } from '@reduxjs/toolkit/query';

import { baseQueryWithReauth } from '@/api/baseQuery';
import {
  clinicFlowReducerPath,
  type ClinicFlowTagType,
} from '@/api/tagTypes';
import type {
  Patient,
  PatientCreatePayload,
  PatientList,
  PatientUpdatePayload,
} from '@/features/patients/types';

type Builder = EndpointBuilder<
  typeof baseQueryWithReauth,
  ClinicFlowTagType,
  typeof clinicFlowReducerPath
>;

export function patientEndpoints(builder: Builder) {
  return {
    searchPatients: builder.query<PatientList, { q: string; limit?: number; offset?: number }>({
      query: ({ q, limit = 50, offset = 0 }) => ({
        url: '/api/v1/patients',
        params: { q, limit, offset },
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((patient) => ({ type: 'Patient' as const, id: patient.patient_id })),
              { type: 'Patient' as const, id: 'LIST' },
            ]
          : [{ type: 'Patient' as const, id: 'LIST' }],
    }),
    createPatient: builder.mutation<Patient, PatientCreatePayload>({
      query: (body) => ({ url: '/api/v1/patients', method: 'POST', body }),
      invalidatesTags: [{ type: 'Patient', id: 'LIST' }],
    }),
    getPatient: builder.query<Patient, string>({
      query: (patientId) => `/api/v1/patients/${patientId}`,
      providesTags: (_result, _error, patientId) => [{ type: 'Patient', id: patientId }],
    }),
    updatePatient: builder.mutation<Patient, { patientId: string; body: PatientUpdatePayload }>({
      query: ({ patientId, body }) => ({
        url: `/api/v1/patients/${patientId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Patient', id: arg.patientId },
        { type: 'Patient', id: 'LIST' },
      ],
    }),
  };
}
