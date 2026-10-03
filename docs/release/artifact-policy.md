# ClinicFlow V1 — Release Artifact & Compatibility Policy

For every production release retain together:

- signed Android APK
- APK SHA-256 checksum
- app version and Android version code
- backend semantic version/build identifier
- Git commit SHA
- Alembic database revision
- release notes
- deployment date/operator

Within `/api/v1`, backend changes should remain compatible with the currently deployed mobile build whenever practical. Prefer additive API/schema changes before removals. If a future backend truly requires a newer app, return a stable compatibility error and show an explicit **Please update ClinicFlow** experience rather than allowing unrelated API failures.

Never archive Android signing private keys inside the repository or release ZIP. Store signing keys and recovery material in a separate protected backup location.
