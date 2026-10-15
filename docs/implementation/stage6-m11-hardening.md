# ClinicFlow V1 — Stage 6 M11 Security / Concurrency / Recovery Hardening

> Historical milestone snapshot. Current implementation status, suite counts and production gates are maintained in [V1 production readiness](../release/v1-production-readiness.md); the original evidence below is retained for traceability.

## Scope

M11 adds no clinic features. It hardens the existing M0–M10 workflows against concurrency races, retries, invalid sessions, malformed requests, production misconfiguration, audit tampering, and recovery failures.

## Backend hardening

- Staging/production startup now fails closed when the JWT signing secret is default, placeholder-like, or shorter than 32 characters.
- Staging/production requires a PostgreSQL database URL.
- API responses add `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` for API paths.
- Request IDs are stored both in the context variable and request state so even unexpected 500 responses retain correlation IDs.
- Validation, 404/405, application, and unexpected errors now use one ClinicFlow error envelope. Unexpected errors expose no stack/SQL/secret detail.
- JSON request logging records request ID, method, path, status and duration only. Request bodies and patient content are not logged.
- Audit request IDs are normalized to real UUID values in every audit-writing module.
- Audit redaction regression tests cover passwords, hashes, access/refresh tokens and generic secrets recursively.
- Expired idempotency rows can be removed through `python -m scripts.housekeeping`; no business history is touched.

## Mobile retry/session hardening

- Booking, follow-up booking, completion, check-in, walk-in, Cash confirmation, UPI confirmation and payment VOID now keep one idempotency key for the screen/action lifetime. A network retry therefore replays the same command instead of creating a new command.
- Every API request carries a UUID-shaped `X-Request-ID` for backend correlation.
- Refresh-token rotation remains single-flight.
- A temporary network failure during refresh no longer destroys local credentials.
- A server-confirmed invalid/expired refresh session clears credentials and sends the user to Login with an explicit session-expired message.
- Fetch/timeout/parsing failures now produce consistent human-readable network/server messages.
- Expo Router has a safe `+not-found` recovery screen for broken/obsolete deep links.

## PostgreSQL concurrency/integrity suite

`backend/tests/integration/test_transaction_concurrency.py` is intentionally PostgreSQL-only and requires a migrated database plus `CLINICFLOW_RUN_INTEGRATION=1`.

It verifies:

1. two simultaneous users cannot consume the same final normal appointment capacity/slot;
2. replaying one appointment command with the same idempotency key produces one Appointment;
3. two simultaneous check-ins produce one Visit and one PENDING Payment;
4. two simultaneous payment confirmations produce one Receipt;
5. a failed reschedule leaves the original Appointment unchanged;
6. PostgreSQL rejects updates to append-only Audit Events.

The normal local unit suite skips these tests when PostgreSQL is unavailable. CI now starts PostgreSQL 17, runs `alembic upgrade head`, enables the integration suite, and then runs pytest.

## Production topology

Added `infra/docker-compose.production.yml` and `infra/Caddyfile`:

```text
Internet
   ↓ HTTPS
 Caddy
   ↓ internal Docker network
 FastAPI
   ↓ internal Docker network
PostgreSQL
```

PostgreSQL has no host/public port. The backend also has no public host port. Caddy is the only exposed service. Backend filesystem is read-only except `/tmp`, uses `no-new-privileges`, and has a readiness health check.

Migrations remain a separate one-shot deployment command and are not run by every application startup.

## Backup / restore

- `scripts/backup_postgres.sh` creates PostgreSQL custom-format dumps and SHA-256 checksums.
- Rotation baseline: 7 daily, 4 weekly, 6 monthly.
- `scripts/verify_restore.sh` restores a backup into a temporary database, checks Alembic/core tables, and drops the temporary database. It never overwrites the live database.
- `docs/operations/backup-restore.md` defines the disaster-restore sequence.
- Off-host/cloud backups must be encrypted and stored separately from the live database disk.

## Release/recovery documentation

- `docs/operations/production-runbook.md`
- `docs/operations/backup-restore.md`
- `docs/release/artifact-policy.md`
- production environment example: `infra/.env.production.example`

Production release artifacts must preserve signed APK checksum/version, backend version/commit, Alembic revision and release notes. Android signing keys are explicitly excluded from Git/artifact ZIPs.

## Validation performed in this environment

- Python compilation: passed.
- Unit/backend suite: **66 passed**.
- PostgreSQL-only integration suite: **6 skipped locally by design** because Docker/PostgreSQL are unavailable in this execution environment.
- Alembic offline PostgreSQL render: `0001 → 0010` passed.
- OpenAPI generation: 62 paths.
- Mobile TS/TSX syntax transpilation: 70 files, zero syntax diagnostics.
- Production/dev Compose YAML structure: passed.
- Backup/restore shell syntax: passed.
- No remaining inline write-call idempotency-key generation found.

## CI behavior

The GitHub Actions backend job now:

1. starts PostgreSQL 17;
2. installs dependencies;
3. runs Ruff;
4. applies the full Alembic migration chain;
5. enables the PostgreSQL integration suite;
6. runs all pytest tests.

This is the authoritative place for the six concurrency/integrity tests until they are also run on the developer workstation with Docker.

## M11 exit state

M11 is implementation-complete. The remaining work is M12 UAT / Release Candidate execution, including a real local PostgreSQL/Docker run, dependency-aware mobile typecheck/build, physical Android-device testing, WhatsApp handoff, UPI QR scan, backup restore drill, and signed APK/release artifact production.
