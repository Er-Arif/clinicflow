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

function requireText(text, label) {
  if (!manifest.includes(text)) {
    throw new Error(`Merged Android manifest hardening drift: missing ${label}.`);
  }
}

function forbidText(text, label) {
  if (manifest.includes(text)) {
    throw new Error(`Merged Android manifest hardening drift: contains ${label}.`);
  }
}

requireText('android.permission.INTERNET', 'INTERNET permission');
requireText('android.permission.REQUEST_INSTALL_PACKAGES', 'REQUEST_INSTALL_PACKAGES permission');
requireText('android:allowBackup="false"', 'allowBackup=false');
requireText('android:usesCleartextTraffic="false"', 'usesCleartextTraffic=false');
requireText('androidx.core.content.FileProvider', 'ClinicFlow FileProvider');
requireText('${applicationId}.fileprovider'.replace('${applicationId}', 'com.clinicflow.app'), 'ClinicFlow FileProvider authority');

forbidText('android.permission.READ_EXTERNAL_STORAGE', 'legacy external-storage read permission');
forbidText('android.permission.WRITE_EXTERNAL_STORAGE', 'legacy external-storage write permission');
forbidText('android.permission.SYSTEM_ALERT_WINDOW', 'overlay permission');

console.log(`Merged Android manifest hardening is intact: ${path.relative(mobileRoot, preferred)}`);
