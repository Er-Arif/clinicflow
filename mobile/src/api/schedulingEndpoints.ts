import type {
  EndpointBuilder,
  TypedMutationOnQueryStarted,
} from '@reduxjs/toolkit/query';

import { baseQueryWithReauth } from '@/api/baseQuery';
import {
  clinicFlowReducerPath,
  type ClinicFlowTagType,
} from '@/api/tagTypes';
import type {
  AvailabilityResponse,
  BlockScheduleExceptionPayload,
  Doctor,
  FeeConfiguration,
  ScheduleApply,
  ScheduleException,
  ScheduleExceptionsListResponse,
  ScheduleOverview,
  SchedulePreview,
  ScheduleProposal,
  UnblockScheduleExceptionPayload,
  WeeklySchedule,
} from '@/features/scheduling/types';

type Builder = EndpointBuilder<
  typeof baseQueryWithReauth,
  ClinicFlowTagType,
  typeof clinicFlowReducerPath
>;

type RefreshPendingWorklists = (
  domains: ('FollowUp' | 'Reminder')[],
) => TypedMutationOnQueryStarted<unknown, unknown, typeof baseQueryWithReauth>;

export function schedulingEndpoints(
  builder: Builder,
  refreshPendingWorklists: RefreshPendingWorklists,
) {
  return {
    clinicTime: builder.query<
      { clinic_date: string; clinic_now: string; timezone: string },
      void
    >({
      query: () => '/api/v1/clinic/time',
    }),
    listDoctors: builder.query<Doctor[], void>({
      query: () => '/api/v1/doctors',
      providesTags: [{ type: 'Doctor', id: 'LIST' }],
    }),
    getSchedule: builder.query<WeeklySchedule, { doctorId: string; effectiveOn?: string }>({
      query: ({ doctorId, effectiveOn }) => ({
        url: `/api/v1/doctors/${doctorId}/schedule`,
        params: effectiveOn ? { effective_on: effectiveOn } : undefined,
      }),
      providesTags: (_result, _error, arg) => [
        { type: 'Schedule', id: arg.doctorId },
        { type: 'Schedule', id: 'LIST' },
      ],
    }),
    getScheduleOverview: builder.query<ScheduleOverview, string>({
      query: (doctorId) => `/api/v1/doctors/${doctorId}/schedule/overview`,
      providesTags: (_result, _error, doctorId) => [
        { type: 'Schedule', id: doctorId },
        { type: 'Schedule', id: 'LIST' },
      ],
    }),
    previewScheduleImpact: builder.mutation<
      SchedulePreview,
      { doctorId: string; body: ScheduleProposal }
    >({
      query: ({ doctorId, body }) => ({
        url: `/api/v1/doctors/${doctorId}/schedule/preview-impact`,
        method: 'POST',
        body,
      }),
    }),
    smartApplySchedule: builder.mutation<
      ScheduleOverview,
      { doctorId: string; body: ScheduleApply }
    >({
      query: ({ doctorId, body }) => ({
        url: `/api/v1/doctors/${doctorId}/schedule/smart-apply`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: [{ type: 'Schedule', id: 'LIST' }],
    }),
    getAvailability: builder.query<
      AvailabilityResponse,
      { doctorId: string; date: string }
    >({
      query: ({ doctorId, date }) => ({
        url: `/api/v1/doctors/${doctorId}/availability`,
        params: { date },
      }),
      providesTags: (_result, _error, arg) => [
        { type: 'Schedule', id: arg.doctorId },
        { type: 'Schedule', id: `availability:${arg.doctorId}:${arg.date}` },
        { type: 'Schedule', id: 'LIST' },
      ],
    }),
    blockSession: builder.mutation<
      unknown,
      { sessionDefinitionId: string; date: string; reason: string }
    >({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ sessionDefinitionId, date, reason }) => ({
        url: '/api/v1/session-occurrences/block',
        method: 'POST',
        body: {
          session_definition_id: sessionDefinitionId,
          date,
          reason,
        },
      }),
      invalidatesTags: [
        { type: 'Schedule', id: 'LIST' },
        { type: 'Reminder', id: 'LIST' },
      ],
    }),
    unblockSession: builder.mutation<unknown, string>({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: (occurrenceId) => ({
        url: `/api/v1/session-occurrences/${occurrenceId}/unblock`,
        method: 'POST',
      }),
      invalidatesTags: [
        { type: 'Schedule', id: 'LIST' },
        { type: 'Reminder', id: 'LIST' },
      ],
    }),
    listScheduleExceptions: builder.query<
      ScheduleExceptionsListResponse,
      { doctorId: string; fromDate?: string }
    >({
      query: ({ doctorId, fromDate }) => ({
        url: `/api/v1/doctors/${doctorId}/schedule/exceptions`,
        params: fromDate ? { from_date: fromDate } : undefined,
      }),
      providesTags: [{ type: 'Schedule', id: 'LIST' }],
    }),
    blockScheduleException: builder.mutation<
      ScheduleException,
      { doctorId: string; body: BlockScheduleExceptionPayload }
    >({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ doctorId, body }) => ({
        url: `/api/v1/doctors/${doctorId}/schedule/exceptions/block`,
        method: 'POST',
        body,
      }),
      invalidatesTags: [
        { type: 'Schedule', id: 'LIST' },
        { type: 'Reminder', id: 'LIST' },
      ],
    }),
    unblockScheduleExceptions: builder.mutation<
      { unblocked_count: number },
      { doctorId: string; body: UnblockScheduleExceptionPayload }
    >({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ doctorId, body }) => ({
        url: `/api/v1/doctors/${doctorId}/schedule/exceptions/unblock`,
        method: 'POST',
        body,
      }),
      invalidatesTags: [
        { type: 'Schedule', id: 'LIST' },
        { type: 'Reminder', id: 'LIST' },
      ],
    }),
    getCurrentFee: builder.query<FeeConfiguration, { asOf?: string } | void>({
      query: (arg) => ({
        url: '/api/v1/fee-configurations/current',
        params: arg?.asOf ? { as_of: arg.asOf } : undefined,
      }),
      providesTags: [{ type: 'Fee', id: 'CURRENT' }],
    }),
    createFeeConfiguration: builder.mutation<
      FeeConfiguration,
      {
        effective_from: string;
        regular_fee: string;
        followup_fee: string;
        assistant_adjustment_allowed: boolean;
      }
    >({
      query: (body) => ({
        url: '/api/v1/fee-configurations',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: 'Fee', id: 'CURRENT' }],
    }),
  };
}
