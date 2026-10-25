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
const API_REQUEST_TIMEOUT_MS = 20_000;

const rawBaseQuery = fetchBaseQuery({
  baseUrl: apiUrl,
  timeout: API_REQUEST_TIMEOUT_MS,
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: controller.signal,
    });
  } catch {
    // A temporary network failure or timeout must not destroy a still-valid local session.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      // Ignore an obsolete refresh response if the user signed out or another
      // session replaced this refresh token while the request was in flight.
      if ((await getRefreshToken()) !== refreshToken) return null;
      await clearSessionTokens();
      notifySessionExpired();
    }
    return null;
  }

  let tokens: TokenPair;
  try {
    tokens = (await response.json()) as TokenPair;
  } catch {
    return null;
  }

  // A successful response can still be stale. Never resurrect credentials
  // after local sign-out or overwrite a newer sign-in session.
  if ((await getRefreshToken()) !== refreshToken) return null;
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
