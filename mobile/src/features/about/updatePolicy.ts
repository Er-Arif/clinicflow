import type { SystemInfo } from '@/api/systemEndpoints';
import { compareVersions } from '@/features/about/version';

export type UpdateDecision = {
  state: 'current' | 'available' | 'unavailable';
  mandatory: boolean;
};

type InstalledApp = {
  version: string;
  versionCode: number | null;
};

type UpdatePolicy = Pick<
  SystemInfo,
  | 'minimum_mobile_version'
  | 'minimum_mobile_version_code'
  | 'latest_mobile_version'
  | 'latest_mobile_version_code'
  | 'mobile_update_mandatory'
>;

export function evaluateUpdate(
  installed: InstalledApp,
  policy: UpdatePolicy,
): UpdateDecision {
  if (
    !Number.isInteger(installed.versionCode)
    || installed.versionCode === null
    || installed.versionCode < 1
    || !Number.isInteger(policy.minimum_mobile_version_code)
    || policy.minimum_mobile_version_code < 1
    || !Number.isInteger(policy.latest_mobile_version_code)
    || policy.latest_mobile_version_code < policy.minimum_mobile_version_code
  ) {
    return { state: 'unavailable', mandatory: false };
  }

  // Validate both display versions too, but Android versionCode is authoritative
  // for whether one APK can replace another.
  if (
    compareVersions(policy.minimum_mobile_version, installed.version) === null
    || compareVersions(policy.latest_mobile_version, installed.version) === null
  ) {
    return { state: 'unavailable', mandatory: false };
  }

  if (policy.latest_mobile_version_code <= installed.versionCode) {
    return { state: 'current', mandatory: false };
  }

  return {
    state: 'available',
    mandatory:
      installed.versionCode < policy.minimum_mobile_version_code
      || policy.mobile_update_mandatory,
  };
}
