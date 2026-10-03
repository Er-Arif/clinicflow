# ClinicFlow V1 — Stage 6 M12 Release Candidate Preparation

## Status

**Release-candidate preparation implemented. External UAT certification is not yet complete.**

M12 is an evidence gate, not a feature milestone. The repository now contains the tooling and documentation needed to produce a reproducible release candidate, but several gates require an online development machine, Docker/PostgreSQL, a staging deployment, and a physical Android device.

## Implemented in M12 preparation

### Build and compatibility visibility

- Backend exposes `GET /api/v1/system/info` with:
  - backend/application version
  - build commit
  - environment
  - minimum supported mobile version
- FastAPI uses the configured backend version in generated OpenAPI metadata.
- Android configuration has an explicit `versionCode`.
- Owner Settings includes **About ClinicFlow** with mobile version/build and backend build information.

### Release verification tooling

- `scripts/rc_local_verify.sh` and `scripts/rc_local_verify.ps1`
  - provide equivalent Linux/macOS/WSL and Windows PowerShell RC entry points;
  - require committed dependency lockfiles;
  - starts PostgreSQL through Docker Compose;
  - creates a disposable RC database;
  - applies the full Alembic migration chain;
  - runs Ruff and the complete backend suite with PostgreSQL integration tests enabled;
  - runs mobile `npm ci`, lint and full TypeScript checking;
  - removes the disposable database afterward.
- `scripts/uat_smoke.py`
  - exercises deployed liveness/readiness;
  - checks build information;
  - authenticates a real Owner/Admin account;
  - checks `/auth/me`, clinic time, doctor/fee read models and Assistant Home;
  - logs out cleanly;
  - does not mutate clinic business data.
- `scripts/create_release_manifest.py`
  - reads mobile version/versionCode;
  - reads backend version;
  - resolves the actual Alembic head from the migration graph;
  - records APK filename/size/SHA-256;
  - records Git commit and Alembic revision;
  - writes a release-manifest JSON file.

### UAT evidence package

- `docs/uat/m12-uat-plan.md`
- `docs/uat/m12-rc-checklist.md`

The UAT plan contains the five frozen clinic scenarios plus dedicated physical-device WhatsApp, UPI, network/session, backup/restore and signed-APK gates.

## Verification performed in this execution environment

- Backend Python compilation: **PASS**
- Backend unit/static API tests: **67 PASS**
- PostgreSQL-only concurrency/integrity tests discovered: **6**, correctly **SKIPPED** because this sandbox has no Docker/PostgreSQL runtime
- Alembic offline PostgreSQL render `0001 → 0010`: **PASS**
- Generated OpenAPI paths: **63**, including `/api/v1/system/info`
- TypeScript/TSX syntax transpilation: **71 files, 0 diagnostics**
- Production/development Compose YAML structural parse: **PASS**
- Backup/restore and RC shell scripts syntax: **PASS**
- UAT smoke and release-manifest Python scripts compile/help invocation: **PASS**
- Release-manifest self-test with a disposable dummy artifact: **PASS**, resolved Alembic head `0010`

## Current release blockers

### 1. Dependency lockfiles are missing

The repository currently does not contain:

- `backend/uv.lock`
- `mobile/package-lock.json`

This sandbox cannot reach package registries, so generating truthful lockfiles here is impossible. They must not be fabricated.

On an online development machine:

```bash
cd backend
uv lock
uv sync --frozen --dev

cd ../mobile
npm install
npm ci
```

Review and commit both lockfiles before RC verification.

### 2. Real PostgreSQL integration/concurrency run is pending

This sandbox has no Docker/`psql`, so the six race/integrity tests have not been executed against a live PostgreSQL instance here. CI and `scripts/rc_local_verify.sh` are configured to run them with PostgreSQL 17.

### 3. Full dependency-aware mobile checks are pending

The source has passed TypeScript/TSX syntax transpilation, but the dependency-aware Expo lint and `tsc --noEmit` gates require the committed `package-lock.json` plus `npm ci`.

### 4. External UAT is pending

Still requires actual evidence for:

- staging deployment smoke;
- physical Android installation/session behavior;
- WhatsApp handoff;
- real UPI QR scanning/intent behavior;
- network loss/retry behavior;
- backup creation and restore drill;
- signed production APK and release manifest;
- five clinic UAT scenarios;
- final Owner approval.

## Exact next execution sequence

After the two lockfiles are created and committed:

Linux/macOS/WSL:

```bash
./scripts/rc_local_verify.sh
```

Windows PowerShell:

```powershell
.\scripts\rc_local_verify.ps1
```

Then deploy staging and run:

```bash
export CLINICFLOW_UAT_PASSWORD='...'
python scripts/uat_smoke.py \
  --base-url https://staging.example.com \
  --login <owner-login>
```

Perform the manual/device gates in `docs/uat/m12-uat-plan.md` and record evidence in `docs/uat/m12-rc-checklist.md`.

After a signed production APK is created:

```bash
python scripts/create_release_manifest.py \
  --apk /path/to/clinicflow-production.apk \
  --output release-manifest.json
```

M12 is complete only when every required gate is PASS and no critical/high-severity defect remains.
