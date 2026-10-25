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
  Appointment,
  AppointmentCreatePayload,
  AppointmentList,
  AppointmentReschedulePayload,
  AppointmentRescheduleResult,
} from '@/features/appointments/types';
import type {
  VisitCompletionPayload,
  VisitCompletionResult,
} from '@/features/followups/types';
import type {
  CheckInResult,
  Visit,
  WalkInPayload,
} from '@/features/visits/types';

type Builder = EndpointBuilder<
  typeof baseQueryWithReauth,
  ClinicFlowTagType,
  typeof clinicFlowReducerPath
>;

type RefreshPendingWorklists = (
  domains: ('FollowUp' | 'Reminder')[],
) => TypedMutationOnQueryStarted<unknown, unknown, typeof baseQueryWithReauth>;

export function appointmentEndpoints(
  builder: Builder,
  refreshPendingWorklists: RefreshPendingWorklists,
) {
  return {
    listAppointments: builder.query<
      AppointmentList,
      { date?: string; status?: string; patientId?: string }
    >({
      query: ({ date, status, patientId }) => ({
        url: '/api/v1/appointments',
        params: {
          ...(date ? { date } : {}),
          ...(status ? { status } : {}),
          ...(patientId ? { patient_id: patientId } : {}),
        },
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((item) => ({
                type: 'Appointment' as const,
                id: item.appointment_id,
              })),
              { type: 'Appointment' as const, id: 'LIST' },
            ]
          : [{ type: 'Appointment' as const, id: 'LIST' }],
    }),
    getAppointment: builder.query<Appointment, string>({
      query: (appointmentId) => `/api/v1/appointments/${appointmentId}`,
      providesTags: (_result, _error, appointmentId) => [
        { type: 'Appointment', id: appointmentId },
      ],
    }),
    createAppointment: builder.mutation<
      Appointment,
      { body: AppointmentCreatePayload; idempotencyKey: string }
    >({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ body, idempotencyKey }) => ({
        url: '/api/v1/appointments',
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      invalidatesTags: [
        { type: 'Reminder', id: 'LIST' },
        { type: 'Appointment', id: 'LIST' },
        { type: 'Schedule', id: 'LIST' },
        { type: 'FollowUp', id: 'LIST' },
        'Report',
      ],
    }),
    checkInAppointment: builder.mutation<
      CheckInResult,
      { appointmentId: string; idempotencyKey: string }
    >({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ appointmentId, idempotencyKey }) => ({
        url: `/api/v1/appointments/${appointmentId}/check-in`,
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Reminder', id: 'LIST' },
        { type: 'Appointment', id: arg.appointmentId },
        { type: 'Appointment', id: 'LIST' },
        { type: 'Visit', id: 'LIST' },
        { type: 'Payment', id: 'LIST' },
        'Report',
      ],
    }),
    addWalkIn: builder.mutation<
      CheckInResult,
      { body: WalkInPayload; idempotencyKey: string }
    >({
      query: ({ body, idempotencyKey }) => ({
        url: '/api/v1/walk-ins',
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      invalidatesTags: [
        { type: 'Appointment', id: 'LIST' },
        { type: 'Visit', id: 'LIST' },
        { type: 'Payment', id: 'LIST' },
        { type: 'Schedule', id: 'LIST' },
        'Report',
      ],
    }),
    getVisit: builder.query<Visit, string>({
      query: (visitId) => `/api/v1/visits/${visitId}`,
      providesTags: (_result, _error, visitId) => [{ type: 'Visit', id: visitId }],
    }),
    completeVisit: builder.mutation<
      VisitCompletionResult,
      { visitId: string; body: VisitCompletionPayload; idempotencyKey: string }
    >({
      onQueryStarted: refreshPendingWorklists(['FollowUp', 'Reminder']),
      query: ({ visitId, body, idempotencyKey }) => ({
        url: `/api/v1/visits/${visitId}/complete`,
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      invalidatesTags: (result, _error, arg) => [
        { type: 'Reminder', id: 'LIST' },
        { type: 'Visit', id: arg.visitId },
        { type: 'Visit', id: 'LIST' },
        { type: 'Appointment', id: 'LIST' },
        { type: 'Payment', id: 'LIST' },
        { type: 'FollowUp', id: 'LIST' },
        ...(result?.closed_previous_followup_id
          ? [
              {
                type: 'FollowUp' as const,
                id: result.closed_previous_followup_id,
              },
            ]
          : []),
        'Report',
      ],
    }),
    cancelAppointment: builder.mutation<
      Appointment,
      { appointmentId: string; reason: string; note?: string }
    >({
      onQueryStarted: refreshPendingWorklists(['FollowUp', 'Reminder']),
      query: ({ appointmentId, reason, note }) => ({
        url: `/api/v1/appointments/${appointmentId}/cancel`,
        method: 'POST',
        body: { reason, note },
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Reminder', id: 'LIST' },
        { type: 'Appointment', id: arg.appointmentId },
        { type: 'Appointment', id: 'LIST' },
        { type: 'Schedule', id: 'LIST' },
        'FollowUp',
        'Report',
      ],
    }),
    rescheduleAppointment: builder.mutation<
      AppointmentRescheduleResult,
      {
        appointmentId: string;
        body: AppointmentReschedulePayload;
        idempotencyKey: string;
      }
    >({
      onQueryStarted: refreshPendingWorklists(['FollowUp', 'Reminder']),
      query: ({ appointmentId, body, idempotencyKey }) => ({
        url: `/api/v1/appointments/${appointmentId}/reschedule`,
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      invalidatesTags: [
        { type: 'Reminder', id: 'LIST' },
        { type: 'Appointment', id: 'LIST' },
        { type: 'Schedule', id: 'LIST' },
        'FollowUp',
        'Report',
      ],
    }),
  };
}
