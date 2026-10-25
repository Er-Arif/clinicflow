import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, '..');
const intermediates = path.join(mobileRoot, 'android', 'app', 'build', 'intermediates');

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const manifests = walk(intermediates)
  .filter((file) => path.basename(file) === 'AndroidManifest.xml')
  .filter((file) => file.toLowerCase().includes('staging'))
  .filter((file) => file.toLowerCase().includes('merged_manifest'));

if (manifests.length === 0) {
  throw new Error('No Gradle-merged staging AndroidManifest.xml was found. Run :app:processStagingMainManifest first.');
}

const preferred = manifests.find((file) =>
  file.replaceAll('\\', '/').includes('/merged_manifest/staging/processStagingMainManifest/'),
) ?? manifests.find((file) => file.toLowerCase().includes('merged_manifests')) ?? manifests[0];

const manifest = fs.readFileSync(preferred, 'utf8');

function requireText(source, text, label) {
  if (!source.includes(text)) {
    throw new Error(`Merged Android manifest hardening drift: missing ${label}.`);
  }
}

function forbidText(source, text, label) {
  if (source.includes(text)) {
    throw new Error(`Merged Android manifest hardening drift: contains ${label}.`);
  }
}

function requireFileProviderBlock(source) {
  const match = source.match(
    /<provider\b[^>]*android:name="androidx\.core\.content\.FileProvider"[^>]*>[\s\S]*?<\/provider>/,
  );
  if (!match) {
    throw new Error('Merged Android manifest hardening drift: missing ClinicFlow FileProvider block.');
  }
  return match[0];
}

const fileProvider = requireFileProviderBlock(manifest);

requireText(manifest, 'android.permission.INTERNET', 'INTERNET permission');
requireText(manifest, 'android.permission.REQUEST_INSTALL_PACKAGES', 'REQUEST_INSTALL_PACKAGES permission');
requireText(manifest, 'android:allowBackup="false"', 'allowBackup=false');
requireText(manifest, 'android:usesCleartextTraffic="false"', 'usesCleartextTraffic=false');
requireText(fileProvider, 'android:authorities="com.clinicflow.app.fileprovider"', 'ClinicFlow FileProvider authority');
requireText(fileProvider, 'android:exported="false"', 'non-exported FileProvider');
requireText(fileProvider, 'android:grantUriPermissions="true"', 'grant-only FileProvider access');
forbidText(fileProvider, 'android:exported="true"', 'exported FileProvider');

forbidText(manifest, 'android.permission.READ_EXTERNAL_STORAGE', 'legacy external-storage read permission');
forbidText(manifest, 'android.permission.WRITE_EXTERNAL_STORAGE', 'legacy external-storage write permission');
forbidText(manifest, 'android.permission.SYSTEM_ALERT_WINDOW', 'overlay permission');

console.log(`Merged Android manifest hardening is intact: ${path.relative(mobileRoot, preferred)}`);