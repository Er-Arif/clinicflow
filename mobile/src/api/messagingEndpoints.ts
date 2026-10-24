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
  MessageTemplate,
  PreparedMessage,
  Reminder,
  ReminderList,
  ReminderType,
} from '@/features/messaging/types';

type Builder = EndpointBuilder<
  typeof baseQueryWithReauth,
  ClinicFlowTagType,
  typeof clinicFlowReducerPath
>;

type RefreshPendingWorklists = (
  domains: ('FollowUp' | 'Reminder')[],
) => TypedMutationOnQueryStarted<unknown, unknown, typeof baseQueryWithReauth>;

export function messagingEndpoints(
  builder: Builder,
  refreshPendingWorklists: RefreshPendingWorklists,
) {
  return {
    listReminders: builder.query<
      ReminderList,
      {
        status?: string;
        dueOn?: string;
        dueThrough?: string;
        type?: ReminderType;
        followupId?: string;
        appointmentId?: string;
      }
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
    reminderWorklist: builder.infiniteQuery<
      ReminderList,
      { status?: string; dueThrough?: string },
      number
    >({
      infiniteQueryOptions: worklistOptions,
      query: ({ queryArg, pageParam }) => ({
        url: '/api/v1/reminders',
        params: {
          status: queryArg.status,
          due_through: queryArg.dueThrough,
          limit: WORKLIST_PAGE_SIZE,
          offset: pageParam,
        },
      }),
      providesTags: (result) => [
        { type: 'Reminder', id: 'LIST' },
        ...(result?.pages.flatMap((page) =>
          page.items.map((item) => ({ type: 'Reminder' as const, id: item.reminder_id })),
        ) ?? []),
      ],
    }),
    prepareReminder: builder.mutation<
      PreparedMessage,
      { reminderId: string; language?: 'EN' | 'HI' }
    >({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ reminderId, language }) => ({
        url: `/api/v1/reminders/${reminderId}/prepare`,
        method: 'POST',
        body: language ? { language } : {},
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'Reminder', id: arg.reminderId },
      ],
    }),
    markReminderSent: builder.mutation<Reminder, string>({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: (reminderId) => ({
        url: `/api/v1/reminders/${reminderId}/mark-sent`,
        method: 'POST',
      }),
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
      {
        appointmentId: string;
        messageType: Extract<
          ReminderType,
          'APPOINTMENT_CONFIRMATION' | 'APPOINTMENT_CANCELLED' | 'APPOINTMENT_RESCHEDULED'
        >;
        language?: 'EN' | 'HI';
      }
    >({
      onQueryStarted: refreshPendingWorklists(['Reminder']),
      query: ({ appointmentId, messageType, language }) => ({
        url: `/api/v1/appointments/${appointmentId}/messages`,
        method: 'POST',
        body: {
          message_type: messageType,
          ...(language ? { language } : {}),
        },
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
      {
        templateId: string;
        templateBody: string;
        active: boolean;
        expectedVersion: number;
      }
    >({
      query: ({ templateId, templateBody, active, expectedVersion }) => ({
        url: `/api/v1/message-templates/${templateId}`,
        method: 'PATCH',
        body: {
          template_body: templateBody,
          active,
          expected_version: expectedVersion,
        },
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: 'MessageTemplate', id: arg.templateId },
        { type: 'MessageTemplate', id: 'LIST' },
      ],
    }),
  };
}
