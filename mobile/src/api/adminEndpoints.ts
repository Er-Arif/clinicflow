import type { EndpointBuilder } from '@reduxjs/toolkit/query';

import { baseQueryWithReauth } from '@/api/baseQuery';
import {
  clinicFlowReducerPath,
  type ClinicFlowTagType,
} from '@/api/tagTypes';
import type {
  AdminUser,
  ClinicSettings,
  DoctorSettings,
  RolePreset,
  UserList,
} from '@/features/admin/types';

type Builder = EndpointBuilder<
  typeof baseQueryWithReauth,
  ClinicFlowTagType,
  typeof clinicFlowReducerPath
>;

export function adminEndpoints(builder: Builder) {
  return {
    getClinicSettings: builder.query<ClinicSettings, void>({
      query: () => '/api/v1/clinic/settings',
      providesTags: [{ type: 'ClinicSettings', id: 'CURRENT' }],
    }),
    updateClinicSettings: builder.mutation<
      ClinicSettings,
      {
        clinic_name: string;
        address?: string | null;
        contact_number?: string | null;
        expected_version: number;
      }
    >({
      query: (body) => ({ url: '/api/v1/clinic/settings', method: 'PATCH', body }),
      invalidatesTags: [{ type: 'ClinicSettings', id: 'CURRENT' }, 'Audit'],
    }),
    getDoctorSettings: builder.query<DoctorSettings, string>({
      query: (doctorId) => `/api/v1/doctors/${doctorId}/settings`,
      providesTags: (_result, _error, doctorId) => [
        { type: 'DoctorSettings', id: doctorId },
      ],
    }),
    updateDoctorSettings: builder.mutation<
      DoctorSettings,
      {
        doctorId: string;
        body: {
          display_name: string;
          professional_display_details?: string | null;
          expected_version: number;
        };
      }
    >({
      query: ({ doctorId, body }) => ({
        url: `/api/v1/doctors/${doctorId}/settings`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'DoctorSettings', id: arg.doctorId },
        { type: 'Doctor', id: 'LIST' },
        'Audit',
        'User',
      ],
    }),
    listRolePresets: builder.query<RolePreset[], void>({
      query: () => '/api/v1/roles',
      providesTags: [{ type: 'User', id: 'ROLES' }],
    }),
    listUsers: builder.query<UserList, void>({
      query: () => '/api/v1/users',
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((user) => ({ type: 'User' as const, id: user.user_id })),
              { type: 'User' as const, id: 'LIST' },
            ]
          : [{ type: 'User' as const, id: 'LIST' }],
    }),
    getAdminUser: builder.query<AdminUser, string>({
      query: (userId) => `/api/v1/users/${userId}`,
      providesTags: (_result, _error, userId) => [{ type: 'User', id: userId }],
    }),
    createAdminUser: builder.mutation<
      AdminUser,
      {
        display_name: string;
        login_identifier: string;
        temporary_password: string;
        role_codes: string[];
      }
    >({
      query: (body) => ({ url: '/api/v1/users', method: 'POST', body }),
      invalidatesTags: [
        { type: 'User', id: 'LIST' },
        'Audit',
        { type: 'Doctor', id: 'LIST' },
      ],
    }),
    updateAdminUser: builder.mutation<
      AdminUser,
      {
        userId: string;
        body: {
          expected_version: number;
          display_name?: string;
          login_identifier?: string;
          active?: boolean;
          role_codes?: string[];
        };
      }
    >({
      query: ({ userId, body }) => ({
        url: `/api/v1/users/${userId}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'User', id: arg.userId },
        { type: 'User', id: 'LIST' },
        'Audit',
        { type: 'Doctor', id: 'LIST' },
      ],
    }),
    resetAdminUserPassword: builder.mutation<
      AdminUser,
      { userId: string; temporary_password: string; reason: string }
    >({
      query: ({ userId, ...body }) => ({
        url: `/api/v1/users/${userId}/reset-password`,
        method: 'POST',
        body,
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'User', id: arg.userId },
        { type: 'User', id: 'LIST' },
        'Audit',
      ],
    }),
  };
}
