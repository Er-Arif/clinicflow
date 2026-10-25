import { refreshSessionSingleFlight } from '@/api/api';
import { getRefreshToken, TokenPair } from '@/auth/session';

export type SessionBootstrapResult =
  | { status: 'authenticated'; tokens: TokenPair }
  | { status: 'retry' }
  | { status: 'signed-out' };

export async function bootstrapSession(): Promise<SessionBootstrapResult> {
  try {
    const tokens = await refreshSessionSingleFlight();
    if (tokens) return { status: 'authenticated', tokens };

    const retainedRefreshToken = await getRefreshToken();
    return retainedRefreshToken ? { status: 'retry' } : { status: 'signed-out' };
  } catch {
    // Startup must fail closed to a retry state rather than destroy or hide a
    // locally retained session when the network or secure storage is transiently unavailable.
    return { status: 'retry' };
  }
}
