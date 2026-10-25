import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, '..');

const appConfig = JSON.parse(
  fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8'),
).expo;
const packageJson = JSON.parse(
  fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'),
);
const gradle = fs.readFileSync(
  path.join(mobileRoot, 'android', 'app', 'build.gradle'),
  'utf8',
);

function requiredMatch(pattern, label) {
  const match = gradle.match(pattern);
  if (!match) {
    throw new Error(`Unable to read native ${label} from android/app/build.gradle.`);
  }
  return match[1];
}

const nativePackage = requiredMatch(/\bapplicationId\s+['"]([^'"]+)['"]/, 'applicationId');
const nativeVersionCode = Number(requiredMatch(/\bversionCode\s+(\d+)\b/, 'versionCode'));
const nativeVersionName = requiredMatch(/\bversionName\s+['"]([^'"]+)['"]/, 'versionName');

if (!Number.isSafeInteger(appConfig.android?.versionCode) || appConfig.android.versionCode < 1) {
  throw new Error('app.json android.versionCode must be a positive integer.');
}
if (appConfig.android?.package !== nativePackage) {
  throw new Error(
    `Android package drift: app.json=${appConfig.android?.package ?? 'missing'} native=${nativePackage}.`,
  );
}
if (appConfig.android.versionCode !== nativeVersionCode) {
  throw new Error(
    `Android versionCode drift: app.json=${appConfig.android.versionCode} native=${nativeVersionCode}.`,
  );
}
if (appConfig.version !== nativeVersionName) {
  throw new Error(
    `Android versionName drift: app.json=${appConfig.version} native=${nativeVersionName}.`,
  );
}
if (packageJson.version !== appConfig.version) {
  throw new Error(
    `Mobile package version drift: package.json=${packageJson.version} app.json=${appConfig.version}.`,
  );
}

console.log(
  `Release metadata aligned: ${nativePackage} ${nativeVersionName} (${nativeVersionCode}).`,
);
