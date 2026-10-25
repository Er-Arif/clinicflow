import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'clinicflow.refresh_token';
let accessToken: string | null = null;
let secureStoreMutation: Promise<void> = Promise.resolve();

export type AuthUser = {
  user_id: string;
  clinic_id: string;
  display_name: string;
  roles: string[];
  permissions: string[];
  must_change_password: boolean;
};

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: AuthUser;
};

export function getAccessToken() {
  return accessToken;
}

function queueSecureStoreMutation(operation: () => Promise<void>): Promise<void> {
  const next = secureStoreMutation.then(operation, operation);
  // Keep future mutations usable even when this caller observes a storage failure.
  secureStoreMutation = next.catch(() => {});
  return next;
}

export async function setSessionTokens(tokens: TokenPair) {
  accessToken = tokens.access_token;
  await queueSecureStoreMutation(() =>
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refresh_token)
  );
}

export async function getRefreshToken() {
  while (true) {
    const pendingMutation = secureStoreMutation;
    await pendingMutation;
    if (pendingMutation !== secureStoreMutation) continue;

    const token = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    // A sign-in/sign-out may have begun while SecureStore was reading. Retry
    // after that mutation so callers never act on an already-stale token.
    if (pendingMutation === secureStoreMutation) return token;
  }
}

export async function clearSessionTokens() {
  accessToken = null;
  await queueSecureStoreMutation(() =>
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)
  );
}

export { getInitialRouteForRoles, isDoctorOrOwner, isAssistantRole } from '@/auth/roles';
