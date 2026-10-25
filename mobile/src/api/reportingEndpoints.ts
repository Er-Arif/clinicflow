import type { EndpointBuilder } from '@reduxjs/toolkit/query';

import { baseQueryWithReauth } from '@/api/baseQuery';
import {
  clinicFlowReducerPath,
  type ClinicFlowTagType,
} from '@/api/tagTypes';
import type {
  AppointmentReport,
  AssistantHome,
  AuditEvent,
  AuditEventList,
  DoctorToday,
  FollowUpReport,
  OwnerDashboard,
  PatientOperationalSummary,
  PatientReport,
  PaymentReport,
} from '@/features/reporting/types';

type Builder = EndpointBuilder<
  typeof baseQueryWithReauth,
  ClinicFlowTagType,
  typeof clinicFlowReducerPath
>;

export function reportingEndpoints(builder: Builder) {
  return {
    getAssistantHome: builder.query<AssistantHome, void>({
      query: () => '/api/v1/home/assistant',
      providesTags: ['Report'],
    }),
    getDoctorToday: builder.query<DoctorToday, { date?: string } | void>({
      query: (arg) => ({
        url: '/api/v1/doctor/today',
        params: arg?.date ? { date: arg.date } : undefined,
      }),
      providesTags: ['Report'],
    }),
    getPatientOperationalSummary: builder.query<PatientOperationalSummary, string>({
      query: (patientId) => `/api/v1/patients/${patientId}/operational-summary`,
      providesTags: (_result, _error, patientId) => [
        { type: 'Patient', id: patientId },
        { type: 'Report' as const },
      ],
    }),
    getOwnerDashboard: builder.query<OwnerDashboard, { from: string; to: string }>({
      query: ({ from, to }) => ({
        url: '/api/v1/dashboard/owner',
        params: { from, to },
      }),
      providesTags: ['Report'],
    }),
    getAppointmentReport: builder.query<AppointmentReport, { from: string; to: string }>({
      query: ({ from, to }) => ({
        url: '/api/v1/reports/appointments',
        params: { from, to },
      }),
      providesTags: ['Report'],
    }),
    getPatientReport: builder.query<PatientReport, { from: string; to: string }>({
      query: ({ from, to }) => ({
        url: '/api/v1/reports/patients',
        params: { from, to },
      }),
      providesTags: ['Report'],
    }),
    getFollowUpReport: builder.query<FollowUpReport, { from: string; to: string }>({
      query: ({ from, to }) => ({
        url: '/api/v1/reports/followups',
        params: { from, to },
      }),
      providesTags: ['Report'],
    }),
    getPaymentReport: builder.query<PaymentReport, { from: string; to: string }>({
      query: ({ from, to }) => ({
        url: '/api/v1/reports/payments',
        params: { from, to },
      }),
      providesTags: ['Report'],
    }),
    listAuditEvents: builder.query<
      AuditEventList,
      {
        from?: string;
        to?: string;
        actorUserId?: string;
        actionType?: string;
        entityType?: string;
        limit?: number;
        offset?: number;
      }
    >({
      query: ({
        from,
        to,
        actorUserId,
        actionType,
        entityType,
        limit = 50,
        offset = 0,
      }) => ({
        url: '/api/v1/audit-events',
        params: {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(actorUserId ? { actor_user_id: actorUserId } : {}),
          ...(actionType ? { action_type: actionType } : {}),
          ...(entityType ? { entity_type: entityType } : {}),
          limit,
          offset,
        },
      }),
      providesTags: ['Audit'],
    }),
    getAuditEvent: builder.query<AuditEvent, string>({
      query: (auditId) => `/api/v1/audit-events/${auditId}`,
      providesTags: (_result, _error, auditId) => [{ type: 'Audit', id: auditId }],
    }),
  };
}
