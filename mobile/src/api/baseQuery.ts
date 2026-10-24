import {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
  fetchBaseQuery,
} from '@reduxjs/toolkit/query/react';

import { applyMobileClientHeaders } from '@/api/clientMetadata';
import { getApiUrl } from '@/api/config';
import { newRequestId } from '@/api/requestId';
import { notifySessionExpired } from '@/auth/sessionEvents';
import {
  TokenPair,
  clearSessionTokens,
  getAccessToken,
  getRefreshToken,
  setSessionTokens,
} from '@/auth/session';
import { notifyMobileUpdateRequired } from '@/features/about/updateEvents';

const apiUrl = getApiUrl();

const rawBaseQuery = fetchBaseQuery({
  baseUrl: apiUrl,
  prepareHeaders: (headers) => {
    const token = getAccessToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (!headers.has('x-request-id')) headers.set('x-request-id', newRequestId());
    return applyMobileClientHeaders(headers);
  },
});

let refreshPromise: Promise<TokenPair | null> | null = null;

async function performRefresh(): Promise<TokenPair | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) return null;

  const headers = applyMobileClientHeaders(new Headers({
    'content-type': 'application/json',
    'x-request-id': newRequestId(),
  }));

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers,
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

export const baseQueryWithReauth: BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
> = async (args, api, extraOptions) => {
  let result = await rawBaseQuery(args, api, extraOptions);
  const url = typeof args === 'string' ? args : args.url;
  const isAuthBootstrap = url.includes('/auth/login') || url.includes('/auth/refresh');

  if (result.error?.status === 426) {
    notifyMobileUpdateRequired();
    return result;
  }

  if (result.error?.status === 401 && !isAuthBootstrap) {
    const refreshed = await refreshSessionSingleFlight();
    if (refreshed) result = await rawBaseQuery(args, api, extraOptions);
  }
  return result;
};
