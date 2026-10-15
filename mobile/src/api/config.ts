export function resolveApiUrl(raw: string | undefined, development: boolean, allowHttp: boolean): string {
  if (!raw?.trim()) throw new Error('EXPO_PUBLIC_API_URL is required.');
  const url = new URL(raw.trim());
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('EXPO_PUBLIC_API_URL must be an origin without credentials, path, query or fragment.');
  }
  if (url.protocol !== 'https:' && !(development && allowHttp && url.protocol === 'http:')) {
    throw new Error('ClinicFlow requires HTTPS. Local HTTP needs an explicit development opt-in.');
  }
  return url.origin;
}

export function getApiUrl(): string {
  return resolveApiUrl(
    process.env.EXPO_PUBLIC_API_URL,
    typeof __DEV__ !== 'undefined' && __DEV__,
    process.env.EXPO_PUBLIC_ALLOW_HTTP === 'true',
  );
}
