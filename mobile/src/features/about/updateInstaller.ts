import { NativeModules, Platform } from 'react-native';

type NativeUpdateInstaller = {
  canRequestPackageInstalls(): Promise<boolean>;
  openUnknownSourcesSettings(): Promise<boolean>;
  downloadAndInstall(
    apkUrl: string,
    sha256: string,
    expectedVersionCode: number,
  ): Promise<boolean>;
};

function installer(): NativeUpdateInstaller {
  if (Platform.OS !== 'android') {
    throw new Error('ClinicFlow in-app updates are available only on Android.');
  }
  const module = NativeModules.ClinicFlowUpdateInstaller as NativeUpdateInstaller | undefined;
  if (!module) {
    throw new Error('The ClinicFlow Android update installer is unavailable in this build.');
  }
  return module;
}

export async function canRequestPackageInstalls(): Promise<boolean> {
  return installer().canRequestPackageInstalls();
}

export async function openUnknownSourcesSettings(): Promise<void> {
  await installer().openUnknownSourcesSettings();
}

export async function downloadAndInstallUpdate(
  apkUrl: string,
  sha256: string,
  expectedVersionCode: number,
): Promise<void> {
  await installer().downloadAndInstall(apkUrl, sha256, expectedVersionCode);
}
