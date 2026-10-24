import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, '..');
const mainManifest = fs.readFileSync(
  path.join(mobileRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  'utf8',
);
const debugManifest = fs.readFileSync(
  path.join(mobileRoot, 'android', 'app', 'src', 'debug', 'AndroidManifest.xml'),
  'utf8',
);
const updatePaths = fs.readFileSync(
  path.join(mobileRoot, 'android', 'app', 'src', 'main', 'res', 'xml', 'update_file_paths.xml'),
  'utf8',
);
const mainApplication = fs.readFileSync(
  path.join(
    mobileRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    'com',
    'clinicflow',
    'app',
    'MainApplication.kt',
  ),
  'utf8',
);
const updateModule = fs.readFileSync(
  path.join(
    mobileRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    'com',
    'clinicflow',
    'app',
    'ClinicFlowUpdateModule.kt',
  ),
  'utf8',
);

function requireText(source, text, label) {
  if (!source.includes(text)) {
    throw new Error(`Android hardening drift: missing ${label}.`);
  }
}

function forbidText(source, text, label) {
  if (source.includes(text)) {
    throw new Error(`Android hardening drift: production contains ${label}.`);
  }
}

requireText(
  mainManifest,
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'REQUEST_INSTALL_PACKAGES permission',
);
requireText(mainManifest, 'android:allowBackup="false"', 'allowBackup=false');
requireText(
  mainManifest,
  'android:usesCleartextTraffic="false"',
  'usesCleartextTraffic=false',
);
requireText(
  mainManifest,
  'android:name="androidx.core.content.FileProvider"',
  'private FileProvider',
);
requireText(mainManifest, 'android:exported="false"', 'non-exported FileProvider');
requireText(
  mainManifest,
  'android:resource="@xml/update_file_paths"',
  'restricted update FileProvider paths',
);
requireText(
  mainManifest,
  'android:name="expo.modules.updates.ENABLED" android:value="false"',
  'disabled Expo OTA updates',
);
requireText(
  mainManifest,
  'android:name="expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH" android:value="NEVER"',
  'disabled Expo update launch checks',
);
requireText(
  mainManifest,
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" tools:node="remove"/>',
  'READ_EXTERNAL_STORAGE removal directive',
);
requireText(
  mainManifest,
  '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" tools:node="remove"/>',
  'WRITE_EXTERNAL_STORAGE removal directive',
);
forbidText(
  mainManifest,
  'android.permission.SYSTEM_ALERT_WINDOW',
  'overlay permission',
);

requireText(
  updatePaths,
  '<cache-path name="clinicflow_updates" path="updates/"',
  'app-private update cache path',
);
forbidText(updatePaths, '<external-path', 'external FileProvider path');
forbidText(updatePaths, '<root-path', 'root FileProvider path');
requireText(
  mainApplication,
  'add(ClinicFlowUpdatePackage())',
  'ClinicFlow update package registration',
);
requireText(
  updateModule,
  'private const val CLINICFLOW_RELEASE_PATH_PREFIX = "/Er-Arif/clinicflow/releases/download/"',
  'ClinicFlow GitHub Release repository allowlist',
);
requireText(
  updateModule,
  'url.path.startsWith(CLINICFLOW_RELEASE_PATH_PREFIX)',
  'native updater repository path validation',
);
requireText(
  updateModule,
  'archive.packageName != reactApplicationContext.packageName',
  'APK package identity validation',
);
requireText(
  updateModule,
  'archiveSigners != installedSigners',
  'APK signer identity validation',
);

// The dev client may keep overlay/cleartext capability without widening production.
requireText(
  debugManifest,
  'android.permission.SYSTEM_ALERT_WINDOW',
  'debug-only overlay permission',
);
requireText(
  debugManifest,
  'android:usesCleartextTraffic="true"',
  'debug-only cleartext traffic',
);

console.log('Android production manifest and updater hardening are intact.');