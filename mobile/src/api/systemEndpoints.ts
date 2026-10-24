import type { EndpointBuilder } from '@reduxjs/toolkit/query';

import { baseQueryWithReauth } from '@/api/baseQuery';
import {
  clinicFlowReducerPath,
  type ClinicFlowTagType,
} from '@/api/tagTypes';
import type { AuthUser, TokenPair } from '@/auth/session';

type Builder = EndpointBuilder<
  typeof baseQueryWithReauth,
  ClinicFlowTagType,
  typeof clinicFlowReducerPath
>;

export function systemEndpoints(builder: Builder) {
  return {
    liveness: builder.query<{ status: string; utc_time: string }, void>({
      query: () => '/health/live',
    }),
    getSystemInfo: builder.query<
      {
        service: string;
        api_version: string;
        build_commit: string;
        environment: string;
        minimum_mobile_version: string;
      },
      void
    >({
      query: () => '/api/v1/system/info',
    }),
    login: builder.mutation<
      TokenPair,
      { login_identifier: string; password: string; device_label?: string }
    >({
      query: (body) => ({ url: '/api/v1/auth/login', method: 'POST', body }),
    }),
    me: builder.query<AuthUser, void>({
      query: () => '/api/v1/auth/me',
      providesTags: ['User'],
    }),
    logout: builder.mutation<void, void>({
      query: () => ({ url: '/api/v1/auth/logout', method: 'POST' }),
    }),
    changePassword: builder.mutation<
      void,
      { current_password: string; new_password: string }
    >({
      query: (body) => ({
        url: '/api/v1/auth/change-password',
        method: 'POST',
        body,
      }),
    }),
  };
}
