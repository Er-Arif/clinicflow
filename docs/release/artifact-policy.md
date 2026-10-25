# ClinicFlow V1 — Release Artifact & Compatibility Policy

## Production release record

For every production release retain together:

- signed Android APK
- APK SHA-256 checksum
- app version and Android version code
- signing certificate SHA-256 fingerprint
- backend semantic version/build identifier
- Git commit SHA
- Alembic database revision
- release notes
- GitHub Release tag and APK asset URL
- deployment date/operator

The GitHub Release APK is ClinicFlow's official Android distribution artifact. The backend update policy must reference that exact HTTPS `github.com/.../releases/download/.../*.apk` asset and its exact SHA-256 checksum. `CLINICFLOW_MOBILE_APK_URL` and `CLINICFLOW_MOBILE_APK_SHA256` are an inseparable pair; the backend refuses malformed or partial update metadata.

The backend update contract also records:

- `minimum_mobile_version` and `minimum_mobile_version_code`
- `latest_mobile_version` and `latest_mobile_version_code`
- release notes
- explicit mandatory-update policy

Android `versionCode` is authoritative for install ordering. It must increase monotonically for every APK that should replace an earlier ClinicFlow build. Version names remain semantic/display metadata and must stay aligned across `package.json`, `app.json`, and native Gradle; CI enforces that alignment.

An installed build below the minimum supported version code is treated as requiring an update. An explicit mandatory flag can additionally make the currently advertised newer release mandatory. Never publish a mandatory policy without a valid APK URL and checksum.

## API compatibility

Within `/api/v1`, backend changes should remain compatible with the currently deployed mobile build whenever practical. Prefer additive API/schema changes before removals. If a future backend truly requires a newer app, use the update-policy contract and a stable compatibility response rather than allowing unrelated API failures to become the first sign that the client is obsolete.

ClinicFlow sends `X-ClinicFlow-Mobile-Version` and `X-ClinicFlow-Mobile-Version-Code` with API requests. Business APIs enforce the configured minimum version code and return HTTP 426 with `MOBILE_UPDATE_REQUIRED` when the installed build is too old. Health, `/api/v1/system/info`, and authentication remain reachable so an obsolete device can recover its session and learn how to update. The mobile client reacts to a 426 by refreshing the update policy and opening the global update gate; this is event-driven and does not add polling.

For V1 compatibility, a client that predates the build-code header is tolerated while the minimum supported version code remains `1`. Once the minimum is raised above `1`, missing build metadata is treated as unsupported. Therefore **do not raise the minimum above 1 until updater-enabled signed builds have been deployed to all active ClinicFlow devices**.

Before raising the minimum supported build:

1. publish the replacement APK to GitHub Releases;
2. verify its production signing certificate, package name, versionCode and SHA-256;
3. configure the backend latest version/code, direct APK URL, checksum and release notes;
4. prove the in-app updater on a physical Android device, including the first-time “Allow from this source” flow;
5. confirm current devices have received an updater-enabled build;
6. only then advance `CLINICFLOW_MINIMUM_MOBILE_VERSION_CODE` and its matching display version.

## Signing-key custody

Never archive Android signing private keys inside the repository, GitHub Release, APK archive, or release ZIP. Store the production keystore and recovery material in a separate protected backup location. Losing the signing key prevents future APKs from updating existing ClinicFlow installations in place.
