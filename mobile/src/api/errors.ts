import { FetchBaseQueryError } from '@reduxjs/toolkit/query';

export type ApiErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    request_id?: string | null;
  };
};

export function apiError(error: unknown): ApiErrorEnvelope['error'] | null {
  if (!error || typeof error !== 'object') return null;
  const fetchError = error as FetchBaseQueryError & { data?: unknown };
  if (fetchError.status === 'FETCH_ERROR' || fetchError.status === 'TIMEOUT_ERROR') {
    return {
      code: 'NETWORK_UNAVAILABLE',
      message: 'Unable to reach ClinicFlow. Check your connection and try again.',
    };
  }
  if (fetchError.status === 'PARSING_ERROR') {
    return { code: 'SERVER_RESPONSE_INVALID', message: 'ClinicFlow received an unexpected server response. Try again.' };
  }
  if (!('data' in fetchError) || !fetchError.data || typeof fetchError.data !== 'object') return null;
  return (fetchError.data as ApiErrorEnvelope).error ?? null;
}
