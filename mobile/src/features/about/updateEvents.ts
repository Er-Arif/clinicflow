type MobileUpdateRequiredListener = () => void;

const listeners = new Set<MobileUpdateRequiredListener>();

export function subscribeMobileUpdateRequired(
  listener: MobileUpdateRequiredListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyMobileUpdateRequired(): void {
  for (const listener of listeners) listener();
}
