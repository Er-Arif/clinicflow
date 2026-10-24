import type { EndpointBuilder } from '@reduxjs/toolkit/query';

import { baseQueryWithReauth } from '@/api/baseQuery';
import {
  clinicFlowReducerPath,
  type ClinicFlowTagType,
} from '@/api/tagTypes';
import type {
  Payment,
  PaymentConfirmation,
  PaymentList,
  PaymentVoidResult,
  Receipt,
  UpiConfiguration,
  UpiIntent,
} from '@/features/payments/types';

type Builder = EndpointBuilder<
  typeof baseQueryWithReauth,
  ClinicFlowTagType,
  typeof clinicFlowReducerPath
>;

export function paymentEndpoints(builder: Builder) {
  return {
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
      {
        paymentId: string;
        paymentMethod: 'CASH' | 'UPI';
        idempotencyKey: string;
        appointmentId?: string;
        visitId?: string;
      }
    >({
      query: ({ paymentId, paymentMethod, idempotencyKey }) => ({
        url: `/api/v1/payments/${paymentId}/confirm`,
        method: 'POST',
        body: { payment_method: paymentMethod },
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      invalidatesTags: (_result, _error, arg) => {
        const tags: (
          | ClinicFlowTagType
          | { type: ClinicFlowTagType; id: string }
        )[] = [
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
      {
        paymentId: string;
        reason: string;
        createReplacementPayment: boolean;
        idempotencyKey: string;
      }
    >({
      query: ({ paymentId, reason, createReplacementPayment, idempotencyKey }) => ({
        url: `/api/v1/payments/${paymentId}/void`,
        method: 'POST',
        body: {
          reason,
          create_replacement_payment: createReplacementPayment,
        },
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
    updateUpiConfiguration: builder.mutation<
      UpiConfiguration,
      {
        upi_id: string;
        payee_name: string;
        active: boolean;
        expected_version?: number;
      }
    >({
      query: (body) => ({
        url: '/api/v1/upi-configuration',
        method: 'PATCH',
        body,
      }),
      invalidatesTags: [{ type: 'Upi', id: 'CURRENT' }],
    }),
  };
}
