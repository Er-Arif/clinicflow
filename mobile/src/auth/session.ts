import * as SecureStore from 'expo-secure-store';

const REFRESH_TOKEN_KEY = 'clinicflow.refresh_token';
let accessToken: string | null = null;

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

export async function setSessionTokens(tokens: TokenPair) {
  accessToken = tokens.access_token;
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refresh_token);
}

export async function getRefreshToken() {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

export async function clearSessionTokens() {
  accessToken = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}
