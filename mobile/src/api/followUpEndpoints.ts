import type {
  EndpointBuilder,
  TypedMutationOnQueryStarted,
} from '@reduxjs/toolkit/query';

import { baseQueryWithReauth } from '@/api/baseQuery';
import {
  clinicFlowReducerPath,
  type ClinicFlowTagType,
} from '@/api/tagTypes';
import { WORKLIST_PAGE_SIZE, worklistOptions } from '@/api/worklists';
import type {
  FollowUp,
  FollowUpBookPayload,
  FollowUpBookResult,
  FollowUpList,
} from '@/features/followups/types';

type Builder = EndpointBuilder<
  typeof baseQueryWithReauth,
  ClinicFlowTagType,
  typeof clinicFlowReducerPath
>;

type RefreshPendingWorklists = (
  domains: ('FollowUp' | 'Reminder')[],
) => TypedMutationOnQueryStarted<unknown, unknown, typeof baseQueryWithReauth>;

export function followUpEndpoints(
  builder: Builder,
  refreshPendingWorklists: RefreshPendingWorklists,
) {
  return {
    listFollowUps: builder.query<FollowUpList, { state?: string; patientId?: string }>({
      query: ({ state, patientId }) => ({
        url: '/api/v1/followups',
        params: {
          ...(state ? { state } : {}),
          ...(patientId ? { patient_id: patientId } : {}),
        },
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((item) => ({
                type: 'FollowUp' as const,
                id: item.followup_id,
              })),
              { type: 'FollowUp' as const, id: 'LIST' },
            ]
          : [{ type: 'FollowUp' as const, id: 'LIST' }],
    }),
    followUpWorklist: builder.infiniteQuery<
      FollowUpList,
      { state?: string; patientId?: string },
      number
    >({
      infiniteQueryOptions: worklistOptions,
      query: ({ queryArg, pageParam }) => ({
        url: '/api/v1/followups',
        params: {
          state: queryArg.state,
          patient_id: queryArg.patientId,
          limit: WORKLIST_PAGE_SIZE,
          offset: pageParam,
        },
      }),
      providesTags: (result) => [
        { type: 'FollowUp', id: 'LIST' },
        ...(result?.pages.flatMap((page) =>
          page.items.map((item) => ({ type: 'FollowUp' as const, id: item.followup_id })),
        ) ?? []),
      ],
    }),
    getFollowUp: builder.query<FollowUp, string>({
      query: (followupId) => `/api/v1/followups/${followupId}`,
      providesTags: (_result, _error, followupId) => [
        { type: 'FollowUp', id: followupId },
      ],
    }),
    bookFollowUp: builder.mutation<
      FollowUpBookResult,
      { followupId: string; body: FollowUpBookPayload; idempotencyKey: string }
    >({
      onQueryStarted: refreshPendingWorklists(['FollowUp', 'Reminder']),
      query: ({ followupId, body, idempotencyKey }) => ({
        url: `/api/v1/followups/${followupId}/book`,
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Reminder', id: 'LIST' },
        { type: 'FollowUp', id: arg.followupId },
        { type: 'FollowUp', id: 'LIST' },
        { type: 'Appointment', id: 'LIST' },
        { type: 'Schedule', id: 'LIST' },
        'Report',
      ],
    }),
    closeFollowUp: builder.mutation<
      FollowUp,
      { followupId: string; reason: string; note?: string }
    >({
      onQueryStarted: refreshPendingWorklists(['FollowUp', 'Reminder']),
      query: ({ followupId, reason, note }) => ({
        url: `/api/v1/followups/${followupId}/close`,
        method: 'POST',
        body: { reason, ...(note ? { note } : {}) },
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Reminder', id: 'LIST' },
        { type: 'FollowUp', id: arg.followupId },
        { type: 'FollowUp', id: 'LIST' },
        'Report',
      ],
    }),
  };
}
