import {
  createApi,
  type TypedMutationOnQueryStarted,
} from '@reduxjs/toolkit/query/react';

import { adminEndpoints } from '@/api/adminEndpoints';
import { appointmentEndpoints } from '@/api/appointmentEndpoints';
import { baseQueryWithReauth } from '@/api/baseQuery';
import { followUpEndpoints } from '@/api/followUpEndpoints';
import { messagingEndpoints } from '@/api/messagingEndpoints';
import { patientEndpoints } from '@/api/patientEndpoints';
import { paymentEndpoints } from '@/api/paymentEndpoints';
import { reportingEndpoints } from '@/api/reportingEndpoints';
import { schedulingEndpoints } from '@/api/schedulingEndpoints';
import { systemEndpoints } from '@/api/systemEndpoints';
import {
  clinicFlowReducerPath,
  clinicFlowTagTypes,
} from '@/api/tagTypes';

export { refreshSessionSingleFlight } from '@/api/baseQuery';

function refreshPendingWorklists(
  domains: ('FollowUp' | 'Reminder')[],
): TypedMutationOnQueryStarted<unknown, unknown, typeof baseQueryWithReauth> {
  return async (_arg, { dispatch, getState, queryFulfilled }) => {
    const pendingPages = (nextOnly: boolean) => {
      const state = getState() as Parameters<typeof api.util.selectInvalidatedBy>[0];
      return domains.flatMap((domain) => {
        const name = domain === 'FollowUp' ? 'followUpWorklist' : 'reminderWorklist';
        return api.util.selectCachedArgsForQuery(state, name).flatMap((arg) => {
          const query = api.endpoints[name].select(arg)(state);
          // A first read started during the write has no provided tags yet.
          if (!query.isLoading || (nextOnly && !query.isFetchingNextPage && query.data)) {
            return [];
          }
          const running = dispatch(api.util.getRunningQueryThunk(name, arg));
          return running ? [running] : [];
        });
      });
    };

    const started = pendingPages(false);
    try {
      await queryFulfilled;
    } catch {
      // Failed writes still reconcile any overlapping read.
    }

    const pending = [...started, ...pendingPages(true)];
    if (pending.length === 0) return;

    // RTK 2.13's delayed invalidation does not count infinite-query requests.
    // Replay the tags after overlapping pages settle so a skipped refetch cannot
    // leave their pre-mutation data attached. Ordinary mutations refetch only once.
    await Promise.all(pending);
    dispatch(api.util.invalidateTags(domains.map((type) => ({ type, id: 'LIST' }))));
  };
}

export const api = createApi({
  reducerPath: clinicFlowReducerPath,
  baseQuery: baseQueryWithReauth,
  tagTypes: clinicFlowTagTypes,
  endpoints: (builder) => ({
    ...reportingEndpoints(builder),
    ...systemEndpoints(builder),
    ...patientEndpoints(builder),
    ...schedulingEndpoints(builder, refreshPendingWorklists),
    ...appointmentEndpoints(builder, refreshPendingWorklists),
    ...followUpEndpoints(builder, refreshPendingWorklists),
    ...paymentEndpoints(builder),
    ...messagingEndpoints(builder, refreshPendingWorklists),
    ...adminEndpoints(builder),
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
