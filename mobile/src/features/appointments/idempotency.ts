import { useCallback, useRef, useState } from 'react';

export function newIdempotencyKey(prefix = 'cf') {
  const random = Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function getOrCreateIdempotencyKey(
  keys: Map<string, string>,
  prefix: string,
  intent: string,
) {
  const existing = keys.get(intent);
  if (existing) return existing;

  const key = newIdempotencyKey(prefix);
  keys.set(intent, key);
  return key;
}

export function useIntentIdempotencyKey(prefix: string, intent: string) {
  const keysRef = useRef(new Map<string, string>());
  const [submittedIntent, setSubmittedIntent] = useState<string | null>(null);

  const getKey = useCallback(() => {
    const key = getOrCreateIdempotencyKey(keysRef.current, prefix, intent);
    setSubmittedIntent(intent);
    return key;
  }, [intent, prefix]);

  const reset = useCallback(() => {
    keysRef.current.clear();
    setSubmittedIntent(null);
  }, []);

  return {
    getKey,
    reset,
    resultMatchesIntent: submittedIntent === intent,
  };
}
