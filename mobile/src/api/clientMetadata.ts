import Constants from 'expo-constants';

export type MobileClientMetadata = {
  version: string | null;
  versionCode: number | null;
};

export function getMobileClientMetadata(): MobileClientMetadata {
  const version = Constants.expoConfig?.version?.trim() || null;
  const rawVersionCode = Constants.expoConfig?.android?.versionCode;
  const versionCode = Number.isInteger(rawVersionCode) && (rawVersionCode ?? 0) > 0
    ? rawVersionCode ?? null
    : null;

  return { version, versionCode };
}

export function applyMobileClientHeaders(headers: Headers): Headers {
  const metadata = getMobileClientMetadata();
  if (metadata.version) {
    headers.set('x-clinicflow-mobile-version', metadata.version);
  }
  if (metadata.versionCode !== null) {
    headers.set('x-clinicflow-mobile-version-code', String(metadata.versionCode));
  }
  return headers;
}
