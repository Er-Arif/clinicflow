type SessionExpiredListener = () => void;

const listeners = new Set<SessionExpiredListener>();

export function subscribeSessionExpired(listener: SessionExpiredListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifySessionExpired(): void {
  for (const listener of listeners) listener();
}
