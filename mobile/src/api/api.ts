import {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
  createApi,
  fetchBaseQuery,
  type TypedMutationOnQueryStarted,
} from '@reduxjs/toolkit/query/react';

import { newRequestId } from '@/api/requestId';
import { getApiUrl } from '@/api/config';
import { WORKLIST_PAGE_SIZE, worklistOptions } from '@/api/worklists';
import { notifySessionExpired } from '@/auth/sessionEvents';
import {
  AuthUser,
  TokenPair,
  clearSessionTokens,
  getAccessToken,
  getRefreshToken,
  setSessionTokens,
} from '@/auth/session';
import {
  Patient,
  PatientCreatePayload,
  PatientList,
  PatientUpdatePayload,
} from '@/features/patients/types';
import {
  Appointment,
  AppointmentCreatePayload,
  AppointmentList,
  AppointmentReschedulePayload,
  AppointmentRescheduleResult,
} from '@/features/appointments/types';
import type { CheckInResult, Visit, WalkInPayload } from '@/features/visits/types';
import type { FollowUp, FollowUpBookPayload, FollowUpBookResult, FollowUpList, VisitCompletionPayload, VisitCompletionResult } from '@/features/followups/types';
import type { MessageTemplate, PreparedMessage, Reminder, ReminderList, ReminderType } from '@/features/messaging/types';
import type {
  Payment,
  PaymentConfirmation,
  PaymentList,
  PaymentVoidResult,
  Receipt,
  UpiConfiguration,
  UpiIntent,
} from '@/features/payments/types';
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
import type {
  AdminUser,
  ClinicSettings,
  DoctorSettings,
  RolePreset,
  UserList,
} from '@/features/admin/types';
import {
  AvailabilityResponse,
  BlockScheduleExceptionPayload,
  Doctor,
  FeeConfiguration,
  ScheduleException,
  ScheduleExceptionsListResponse,
  UnblockScheduleExceptionPayload,
  WeeklySchedule,
  ScheduleOverview,
  ScheduleProposal,
  SchedulePreview,
  ScheduleApply,
} from '@/features/scheduling/types';

const apiUrl = getApiUrl();

const rawBaseQuery = fetchBaseQuery({
  baseUrl: apiUrl,
  prepareHeaders: (headers) => {
    const token = getAccessToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (!headers.has('x-request-id')) headers.set('x-request-id', newRequestId());
    return headers;
  },
});

let refreshPromise: Promise<TokenPair | null> | null = null;

async function performRefresh(): Promise<TokenPair | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': newRequestId() },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    // A temporary network failure must not destroy a still-valid local session.
    return null;
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      await clearSessionTokens();
      notifySessionExpired();
    }
    return null;
  }
  const tokens = (await response.json()) as TokenPair;
  await setSessionTokens(tokens);
  return tokens;
}

export async function refreshSessionSingleFlight(): Promise<TokenPair | null> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

const baseQueryWithReauth: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions,
) => {
  let result = await rawBaseQuery(args, api, extraOptions);
  const url = typeof args === 'string' ? args : args.url;
  const isAuthBootstrap = url.includes('/auth/login') || url.includes('/auth/refresh');

  if (result.error?.status === 401 && !isAuthBootstrap) {
    const refreshed = await refreshSessionSingleFlight();
    if (refreshed) result = await rawBaseQuery(args, api, extraOptions);
  }
  return result;
};

function refreshPendingWorklists(domains: ('FollowUp' | 'Reminder')[]): TypedMutationOnQueryStarted<unknown, unknown, typeof baseQueryWithReauth> {
  return async (_arg, { dispatch, getState, queryFulfilled }) => {
    const pendingPages = (nextOnly: boolean) => {
      const state = getState() as Parameters<typeof api.util.selectInvalidatedBy>[0];
      return domains.flatMap(domain => {
        const name = domain === 'FollowUp' ? 'followUpWorklist' : 'reminderWorklist';
        return api.util.selectCachedArgsForQuery(state, name).flatMap(arg => {
          const query = api.endpoints[name].select(arg)(state);
          // A first read started during the write has no provided tags yet.
          if (!query.isLoading || (nextOnly && !query.isFetchingNextPage && query.data)) return [];
          const running = dispatch(api.util.getRunningQueryThunk(name, arg));
          return running ? [running] : [];
        });
      });
    };
    const started = pendingPages(false);
    try { await queryFulfilled; } catch { /* Failed writes still reconcile any overlapping read. */ }
    const pending = [...started, ...pendingPages(true)];
    if (pending.length === 0) return;
    // RTK 2.13's delayed invalidation does not count infinite-query requests.
    // Replay the tags after overlapping pages settle so a skipped refetch cannot
    // leave their pre-mutation data attached. Ordinary mutations refetch only once.
    await Promise.all(pending);
    dispatch(api.util.invalidateTags(domains.map(type => ({ type, id: 'LIST' }))));
  };
}

export const api = createApi({
  reducerPath: 'clinicflowApi',
  baseQuery: baseQueryWithReauth,
  tagTypes: ['Patient', 'Doctor', 'Schedule', 'Fee', 'Appointment', 'Visit', 'Payment', 'Upi', 'FollowUp', 'Reminder', 'MessageTemplate', 'Report', 'User', 'ClinicSettings', 'DoctorSettings', 'Audit'],
  endpoints: (builder) => ({

    getAssistantHome: builder.query<AssistantHome, void>({
      query: () => '/api/v1/home/assistant',
      providesTags: ['Report'],
    }),
    getDoctorToday: builder.query<DoctorToday, { date?: string } | void>({
      query: (arg) => ({ url: '/api/v1/doctor/today', params: arg?.date ? { date: arg.date } : undefined }),
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
      query: ({ from, to }) => ({ url: '/api/v1/dashboard/owner', params: { from, to } }),
      providesTags: ['Report'],
    }),
    getAppointmentReport: builder.query<AppointmentReport, { from: string; to: string }>({
      query: ({ from, to }) => ({ url: '/api/v1/reports/appointments', params: { from, to } }),
      providesTags: ['Report'],
    }),
    getPatientReport: builder.query<PatientReport, { from: string; to: string }>({
      query: ({ from, to }) => ({ url: '/api/v1/reports/patients', params: { from, to } }),
      providesTags: ['Report'],
    }),
    getFollowUpReport: builder.query<FollowUpReport, { from: string; to: string }>({
      query: ({ from, to }) => ({ url: '/api/v1/reports/followups', params: { from, to } }),
      providesTags: ['Report'],
    }),
    getPaymentReport: builder.query<PaymentReport, { from: string; to: string }>({
      query: ({ from, to }) => ({ url: '/api/v1/reports/payments', params: { from, to } }),
      providesTags: ['Report'],
    }),
    listAuditEvents: builder.query<AuditEventList, { from?: string; to?: string; actorUserId?: string; actionType?: string; entityType?: string; limit?: number; offset?: number }>({
      query: ({ from, to, actorUserId, actionType, entityType, limit = 50, offset = 0 }) => ({
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
      providesTags: (_r, _e, auditId) => [{ type: 'Audit', id: auditId }],
    }),
    liveness: builder.query<{ status: string; utc_time: string }, void>({
      query: () => '/health/live',
    }),
    getSystemInfo: builder.query<{ service: string; api_version: string; build_commit: string; environment: string; minimum_mobile_version: string }, void>({
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
    changePassword: builder.mutation<void, { current_password: string; new_password: string }>({
      query: (body) => ({ url: '/api/v1/auth/change-password', method: 'POST', body }),
    }),
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
    clinicTime: builder.query<{ clinic_date: string; clinic_now: string; timezone: string }, void>({
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
    previewScheduleImpact: builder.mutation<SchedulePreview, { doctorId: string; body: ScheduleProposal }>({
      query: ({ doctorId, body }) => ({
        url: `/api/v1/doctors/${doctorId}/schedule/preview-impact`, method: 'POST', body,
      }),
    }),
    smartApplySchedule: builder.mutation<ScheduleOverview, { doctorId: string; body: ScheduleApply }>({
      query: ({ doctorId, body }) => ({
        url: `/api/v1/doctors/${doctorId}/schedule/smart-apply`, method: 'PUT', body,
      }),
      // Also refresh availability and the schedule hub, including after an
      // ambiguous network failure where the server may have committed the change.
      invalidatesTags: [{ type: 'Schedule', id: 'LIST' }],
    }),
    getAvailability: builder.query<AvailabilityResponse, { doctorId: string; date: string }>({
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
    listAppointments: builder.query<AppointmentList, { date?: string; status?: string; patientId?: string }>({
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
              ...result.items.map((item) => ({ type: 'Appointment' as const, id: item.appointment_id })),
              { type: 'Appointment' as const, id: 'LIST' },
            ]
          : [{ type: 'Appointment' as const, id: 'LIST' }],
    }),
    getAppointment: builder.query<Appointment, string>({
      query: (appointmentId) => `/api/v1/appointments/${appointmentId}`,
      providesTags: (_result, _error, appointmentId) => [{ type: 'Appointment', id: appointmentId }],
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
        ...(result?.closed_previous_followup_id ? [{ type: 'FollowUp' as const, id: result.closed_previous_followup_id }] : []),
        'Report',
      ],
    }),
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
              ...result.items.map((item) => ({ type: 'FollowUp' as const, id: item.followup_id })),
              { type: 'FollowUp' as const, id: 'LIST' },
            ]
          : [{ type: 'FollowUp' as const, id: 'LIST' }],
    }),
    followUpWorklist: builder.infiniteQuery<FollowUpList, { state?: string; patientId?: string }, number>({
      infiniteQueryOptions: worklistOptions,
      query: ({ queryArg, pageParam }) => ({
        url: '/api/v1/followups',
        params: { state: queryArg.state, patient_id: queryArg.patientId, limit: WORKLIST_PAGE_SIZE, offset: pageParam },
      }),
      providesTags: (result) => [
        { type: 'FollowUp', id: 'LIST' },
        ...(result?.pages.flatMap(page => page.items.map(item => ({ type: 'FollowUp' as const, id: item.followup_id }))) ?? []),
      ],
    }),
    getFollowUp: builder.query<FollowUp, string>({
      query: (followupId) => `/api/v1/followups/${followupId}`,
      providesTags: (_result, _error, followupId) => [{ type: 'FollowUp', id: followupId }],
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
      // Cancellation clears the link before returning, so its response cannot
      // reliably identify the reopened follow-up. Invalidate this domain's details too.
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
      { appointmentId: string; body: AppointmentReschedulePayload; idempotencyKey: string }
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
    blockSession: builder.mutation<
      unknown,
      { sessionDefinitionId: string; date: string; reason: string }
    >({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ sessionDefinitionId, date, reason }) => ({
        url: '/api/v1/session-occurrences/block',
        method: 'POST',
        body: { session_definition_id: sessionDefinitionId, date, reason },
      }),
      invalidatesTags: [{ type: 'Schedule', id: 'LIST' }, { type: 'Reminder', id: 'LIST' }],
    }),
    unblockSession: builder.mutation<unknown, string>({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: (occurrenceId) => ({
        url: `/api/v1/session-occurrences/${occurrenceId}/unblock`,
        method: 'POST',
      }),
      invalidatesTags: [{ type: 'Schedule', id: 'LIST' }, { type: 'Reminder', id: 'LIST' }],
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
      invalidatesTags: [{ type: 'Schedule', id: 'LIST' }, { type: 'Reminder', id: 'LIST' }],
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
      invalidatesTags: [{ type: 'Schedule', id: 'LIST' }, { type: 'Reminder', id: 'LIST' }],
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
      query: (body) => ({ url: '/api/v1/fee-configurations', method: 'POST', body }),
      invalidatesTags: [{ type: 'Fee', id: 'CURRENT' }],
    }),
    listPayments: builder.query<
      PaymentList,
      { status?: string; date?: string; patientId?: string }
    >({
      query: ({ status, date, patientId }) => ({
        url: '/api/v1/payments',
        params: {
          ...(status ? { status } : {}),
          ...(date ? { date } : {}),
          ...(patientId ? { patient_id: patientId } : {}),
        },
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((item) => ({ type: 'Payment' as const, id: item.payment_id })),
              { type: 'Payment' as const, id: 'LIST' },
            ]
          : [{ type: 'Payment' as const, id: 'LIST' }],
    }),
    getPayment: builder.query<Payment, string>({
      query: (paymentId) => `/api/v1/payments/${paymentId}`,
      providesTags: (_result, _error, paymentId) => [{ type: 'Payment', id: paymentId }],
    }),
    confirmPayment: builder.mutation<
      PaymentConfirmation,
      { paymentId: string; paymentMethod: 'CASH' | 'UPI'; idempotencyKey: string; appointmentId?: string; visitId?: string }
    >({
      query: ({ paymentId, paymentMethod, idempotencyKey }) => ({
        url: `/api/v1/payments/${paymentId}/confirm`,
        method: 'POST',
        body: { payment_method: paymentMethod },
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      invalidatesTags: (_result, _error, arg) => {
        const tags: any[] = [
          { type: 'Payment', id: arg.paymentId },
          { type: 'Payment', id: 'LIST' },
          { type: 'Appointment', id: 'LIST' },
          { type: 'Visit', id: 'LIST' },
          'Report',
        ];
        if (arg.appointmentId) tags.push({ type: 'Appointment', id: arg.appointmentId });
        if (arg.visitId) tags.push({ type: 'Visit', id: arg.visitId });
        return tags;
      },
    }),
    voidPayment: builder.mutation<
      PaymentVoidResult,
      { paymentId: string; reason: string; createReplacementPayment: boolean; idempotencyKey: string }
    >({
      query: ({ paymentId, reason, createReplacementPayment, idempotencyKey }) => ({
        url: `/api/v1/payments/${paymentId}/void`,
        method: 'POST',
        body: { reason, create_replacement_payment: createReplacementPayment },
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Payment', id: arg.paymentId },
        { type: 'Payment', id: 'LIST' },
        { type: 'Appointment', id: 'LIST' },
        { type: 'Visit', id: 'LIST' },
        'Report',
      ],
    }),
    getReceipt: builder.query<Receipt, string>({
      query: (paymentId) => `/api/v1/payments/${paymentId}/receipt`,
      providesTags: (_result, _error, paymentId) => [{ type: 'Payment', id: paymentId }],
    }),
    getUpiIntent: builder.query<UpiIntent, string>({
      query: (paymentId) => `/api/v1/payments/${paymentId}/upi-intent`,
      providesTags: (_result, _error, paymentId) => [{ type: 'Payment', id: paymentId }],
    }),
    getUpiConfiguration: builder.query<UpiConfiguration, void>({
      query: () => '/api/v1/upi-configuration',
      providesTags: [{ type: 'Upi', id: 'CURRENT' }],
    }),
    listReminders: builder.query<
      ReminderList,
      { status?: string; dueOn?: string; dueThrough?: string; type?: ReminderType; followupId?: string; appointmentId?: string }
    >({
      query: ({ status, dueOn, dueThrough, type, followupId, appointmentId }) => ({
        url: '/api/v1/reminders',
        params: {
          ...(status ? { status } : {}),
          ...(dueOn ? { due_on: dueOn } : {}),
          ...(dueThrough ? { due_through: dueThrough } : {}),
          ...(type ? { type } : {}),
          ...(followupId ? { followup_id: followupId } : {}),
          ...(appointmentId ? { appointment_id: appointmentId } : {}),
        },
      }),
      providesTags: (result) =>
        result
          ? [
              ...result.items.map((item) => ({ type: 'Reminder' as const, id: item.reminder_id })),
              { type: 'Reminder' as const, id: 'LIST' },
            ]
          : [{ type: 'Reminder' as const, id: 'LIST' }],
    }),
    reminderWorklist: builder.infiniteQuery<ReminderList, { status?: string; dueThrough?: string }, number>({
      infiniteQueryOptions: worklistOptions,
      query: ({ queryArg, pageParam }) => ({
        url: '/api/v1/reminders',
        params: { status: queryArg.status, due_through: queryArg.dueThrough, limit: WORKLIST_PAGE_SIZE, offset: pageParam },
      }),
      providesTags: (result) => [
        { type: 'Reminder', id: 'LIST' },
        ...(result?.pages.flatMap(page => page.items.map(item => ({ type: 'Reminder' as const, id: item.reminder_id }))) ?? []),
      ],
    }),
    prepareReminder: builder.mutation<PreparedMessage, { reminderId: string; language?: 'EN' | 'HI' }>({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ reminderId, language }) => ({
        url: `/api/v1/reminders/${reminderId}/prepare`,
        method: 'POST',
        body: language ? { language } : {},
      }),
      invalidatesTags: (_result, _error, arg) => [{ type: 'Reminder', id: arg.reminderId }],
    }),
    markReminderSent: builder.mutation<Reminder, string>({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: (reminderId) => ({ url: `/api/v1/reminders/${reminderId}/mark-sent`, method: 'POST' }),
      invalidatesTags: (_result, _error, reminderId) => [
        { type: 'Reminder', id: reminderId },
        { type: 'Reminder', id: 'LIST' },
        'Report',
      ],
    }),
    skipReminder: builder.mutation<Reminder, { reminderId: string; reason: string }>({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ reminderId, reason }) => ({
        url: `/api/v1/reminders/${reminderId}/skip`,
        method: 'POST',
        body: { reason },
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Reminder', id: arg.reminderId },
        { type: 'Reminder', id: 'LIST' },
        'Report',
      ],
    }),
    createAppointmentMessage: builder.mutation<
      PreparedMessage,
      { appointmentId: string; messageType: Extract<ReminderType, 'APPOINTMENT_CONFIRMATION' | 'APPOINTMENT_CANCELLED' | 'APPOINTMENT_RESCHEDULED'>; language?: 'EN' | 'HI' }
    >({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ appointmentId, messageType, language }) => ({
        url: `/api/v1/appointments/${appointmentId}/messages`,
        method: 'POST',
        body: { message_type: messageType, ...(language ? { language } : {}) },
      }),
      invalidatesTags: [{ type: 'Reminder', id: 'LIST' }, 'Report'],
    }),
    listMessageTemplates: builder.query<MessageTemplate[], void>({
      query: () => '/api/v1/message-templates',
      providesTags: (result) =>
        result
          ? [
              ...result.map((item) => ({ type: 'MessageTemplate' as const, id: item.template_id })),
              { type: 'MessageTemplate' as const, id: 'LIST' },
            ]
          : [{ type: 'MessageTemplate' as const, id: 'LIST' }],
    }),
    updateMessageTemplate: builder.mutation<
      MessageTemplate,
      { templateId: string; templateBody: string; active: boolean; expectedVersion: number }
    >({
      query: ({ templateId, templateBody, active, expectedVersion }) => ({
        url: `/api/v1/message-templates/${templateId}`,
        method: 'PATCH',
        body: { template_body: templateBody, active, expected_version: expectedVersion },
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'MessageTemplate', id: arg.templateId },
        { type: 'MessageTemplate', id: 'LIST' },
      ],
    }),
    getClinicSettings: builder.query<ClinicSettings, void>({
      query: () => '/api/v1/clinic/settings',
      providesTags: [{ type: 'ClinicSettings', id: 'CURRENT' }],
    }),
    updateClinicSettings: builder.mutation<ClinicSettings, { clinic_name: string; address?: string | null; contact_number?: string | null; expected_version: number }>({
      query: (body) => ({ url: '/api/v1/clinic/settings', method: 'PATCH', body }),
      invalidatesTags: [{ type: 'ClinicSettings', id: 'CURRENT' }, 'Audit'],
    }),
    getDoctorSettings: builder.query<DoctorSettings, string>({
      query: (doctorId) => `/api/v1/doctors/${doctorId}/settings`,
      providesTags: (_r, _e, doctorId) => [{ type: 'DoctorSettings', id: doctorId }],
    }),
    updateDoctorSettings: builder.mutation<DoctorSettings, { doctorId: string; body: { display_name: string; professional_display_details?: string | null; expected_version: number } }>({
      query: ({ doctorId, body }) => ({ url: `/api/v1/doctors/${doctorId}/settings`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'DoctorSettings', id: arg.doctorId }, { type: 'Doctor', id: 'LIST' }, 'Audit', 'User'],
    }),
    listRolePresets: builder.query<RolePreset[], void>({
      query: () => '/api/v1/roles',
      providesTags: [{ type: 'User', id: 'ROLES' }],
    }),
    listUsers: builder.query<UserList, void>({
      query: () => '/api/v1/users',
      providesTags: (result) => result ? [...result.items.map((u) => ({ type: 'User' as const, id: u.user_id })), { type: 'User' as const, id: 'LIST' }] : [{ type: 'User' as const, id: 'LIST' }],
    }),
    getAdminUser: builder.query<AdminUser, string>({
      query: (userId) => `/api/v1/users/${userId}`,
      providesTags: (_r, _e, userId) => [{ type: 'User', id: userId }],
    }),
    createAdminUser: builder.mutation<AdminUser, { display_name: string; login_identifier: string; temporary_password: string; role_codes: string[] }>({
      query: (body) => ({ url: '/api/v1/users', method: 'POST', body }),
      invalidatesTags: [{ type: 'User', id: 'LIST' }, 'Audit', { type: 'Doctor', id: 'LIST' }],
    }),
    updateAdminUser: builder.mutation<AdminUser, { userId: string; body: { expected_version: number; display_name?: string; login_identifier?: string; active?: boolean; role_codes?: string[] } }>({
      query: ({ userId, body }) => ({ url: `/api/v1/users/${userId}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'User', id: arg.userId }, { type: 'User', id: 'LIST' }, 'Audit', { type: 'Doctor', id: 'LIST' }],
    }),
    resetAdminUserPassword: builder.mutation<AdminUser, { userId: string; temporary_password: string; reason: string }>({
      query: ({ userId, ...body }) => ({ url: `/api/v1/users/${userId}/reset-password`, method: 'POST', body }),
      invalidatesTags: (_r, _e, arg) => [{ type: 'User', id: arg.userId }, { type: 'User', id: 'LIST' }, 'Audit'],
    }),
    updateUpiConfiguration: builder.mutation<
      UpiConfiguration,
      { upi_id: string; payee_name: string; active: boolean; expected_version?: number }
    >({
      query: (body) => ({ url: '/api/v1/upi-configuration', method: 'PATCH', body }),
      invalidatesTags: [{ type: 'Upi', id: 'CURRENT' }],
    }),
  }),
});

export const {
  useGetAssistantHomeQuery,
  useGetDoctorTodayQuery,
  useGetPatientOperationalSummaryQuery,
  useGetOwnerDashboardQuery,
  useGetAppointmentReportQuery,
  useGetPatientReportQuery,
  useGetFollowUpReportQuery,
  useGetPaymentReportQuery,
  useListAuditEventsQuery,
  useGetAuditEventQuery,
  useLivenessQuery,
  useGetSystemInfoQuery,
  useLoginMutation,
  useMeQuery,
  useLogoutMutation,
  useChangePasswordMutation,
  useSearchPatientsQuery,
  useCreatePatientMutation,
  useGetPatientQuery,
  useUpdatePatientMutation,
  useClinicTimeQuery,
  useListDoctorsQuery,
  useGetScheduleQuery,
  useGetScheduleOverviewQuery,
  usePreviewScheduleImpactMutation,
  useSmartApplyScheduleMutation,
  useGetAvailabilityQuery,
  useListAppointmentsQuery,
  useGetAppointmentQuery,
  useCreateAppointmentMutation,
  useCheckInAppointmentMutation,
  useAddWalkInMutation,
  useGetVisitQuery,
  useCompleteVisitMutation,
  useListFollowUpsQuery,
  useFollowUpWorklistInfiniteQuery,
  useGetFollowUpQuery,
  useBookFollowUpMutation,
  useCloseFollowUpMutation,
  useCancelAppointmentMutation,
  useRescheduleAppointmentMutation,
  useBlockSessionMutation,
  useUnblockSessionMutation,
  useListScheduleExceptionsQuery,
  useBlockScheduleExceptionMutation,
  useUnblockScheduleExceptionsMutation,
  useGetCurrentFeeQuery,
  useCreateFeeConfigurationMutation,
  useListPaymentsQuery,
  useGetPaymentQuery,
  useConfirmPaymentMutation,
  useVoidPaymentMutation,
  useGetReceiptQuery,
  useGetUpiIntentQuery,
  useGetUpiConfigurationQuery,
  useListRemindersQuery,
  useReminderWorklistInfiniteQuery,
  usePrepareReminderMutation,
  useMarkReminderSentMutation,
  useSkipReminderMutation,
  useCreateAppointmentMessageMutation,
  useListMessageTemplatesQuery,
  useUpdateMessageTemplateMutation,
  useGetClinicSettingsQuery,
  useUpdateClinicSettingsMutation,
  useGetDoctorSettingsQuery,
  useUpdateDoctorSettingsMutation,
  useListRolePresetsQuery,
  useListUsersQuery,
  useGetAdminUserQuery,
  useCreateAdminUserMutation,
  useUpdateAdminUserMutation,
  useResetAdminUserPasswordMutation,
  useUpdateUpiConfigurationMutation,
} = api;
