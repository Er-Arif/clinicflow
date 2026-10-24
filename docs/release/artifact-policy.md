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

Do not raise the minimum supported mobile version until the replacement signed APK has been published, its checksum verified, and the in-app update path tested on a physical Android device.

## Signing-key custody

Never archive Android signing private keys inside the repository, GitHub Release, APK archive, or release ZIP. Store the production keystore and recovery material in a separate protected backup location. Losing the signing key prevents future APKs from updating existing ClinicFlow installations in place.
