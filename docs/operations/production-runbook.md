# ClinicFlow V1 — Production Runbook

## Production boundary

ClinicFlow supports two deployment profiles:

1. **Render-managed cloud deployment** — the current cloud/staging reference architecture. FastAPI runs as a single web-service instance, Render Postgres remains private, and Render terminates public TLS.
2. **Self-hosted Caddy/Compose deployment** — the hospital-controlled deployment profile. Caddy is the only public edge, FastAPI and PostgreSQL remain on an internal Docker network, and PostgreSQL has no public host port.

The Android app always reaches the API over HTTPS. Production data remains in PostgreSQL and is never stored in a workstation-local writable database.

Current implementation and validation evidence: [V1 production readiness](../release/v1-production-readiness.md). Earlier milestone counts are historical evidence, not the current release gate.

## Render deployment

- Use the `backend` directory and committed Dockerfile. Build with the committed `uv.lock`; do not regenerate dependencies during deployment.
- The image starts with `python -m scripts.serve`. It binds `0.0.0.0:$PORT`, disables raw Uvicorn access logs, and forces exactly **one worker**. Keep one service instance while authentication budgets are process-local.
- Use Render PostgreSQL **18** and the private/internal database connection string. Set `CLINICFLOW_ENVIRONMENT=staging` or `production` as appropriate, a random access secret of at least 32 characters, and a non-placeholder PostgreSQL URL. Never expose PostgreSQL merely to make the API reachable.
- Set `CLINICFLOW_ALLOWED_HOSTS` to an exact JSON array containing the Render service hostname and any verified custom API hostname used by health checks. Keep `CLINICFLOW_CORS_ORIGINS=[]` for the native-only client; if a browser client is introduced, list only exact HTTPS origins.
- Set `CLINICFLOW_CLIENT_IP_SOURCE=render` and keep `CLINICFLOW_TRUSTED_PROXY_IPS=[]`. Render public traffic reaches the service through Cloudflare; ClinicFlow therefore uses Cloudflare-overwritten `CF-Connecting-IP` for authentication throttling rather than trusting a caller-influenced forwarding chain. Missing or malformed client-IP headers fail closed to the shared `unknown` bucket. Do not use the legacy `railway` mode on Render.
- Configure `/health/ready` as the Render HTTP health-check path. `/health/live` checks the process; readiness executes `SELECT 1` and returns a safe 503 on database failure. Readiness does not certify schema compatibility or domain data, so migrations and smoke checks remain separate release gates.
- Prefer auto-deploy **After CI Checks Pass** for the protected release branch. A deploy is not considered successful merely because it was triggered; verify that the new deploy becomes live and then inspect health/logs.
- For a paid Render web service, run `alembic upgrade head` as the pre-deploy command so a failed migration prevents traffic from switching to the new build. If pre-deploy commands are unavailable for the selected plan, run migrations as an explicit serialized release step before application rollout. Never run migrations independently in every worker startup.
- Do not attach a persistent disk to the web service. Application runtime storage is ephemeral; durable state belongs in managed PostgreSQL. The backend image itself is read-only in the self-hosted profile and should remain stateless in cloud deployments too.
- Configure alerts for failed deploys, sustained 5xx/503 responses, restarts, and backup failures. Health checks are a readiness mechanism, not a complete monitoring strategy.

Render reference behavior should be verified against current platform documentation before a production rollout, especially deploy lifecycle, pre-deploy support, health checks, and environment-variable semantics.

## Self-hosted Caddy/Compose deployment

- Use `infra/docker-compose.production.yml` with `infra/.env.production` kept outside Git.
- The production Compose baseline uses PostgreSQL **18**, matching CI and Render staging.
- Caddy is pinned to `172.30.0.10` on the private `172.30.0.0/24` backend network. The backend trusts only `172.30.0.10/32` through Uvicorn's `forwarded_allow_ips`; Caddy sanitizes and rebuilds forwarded headers before proxying. Keep `CLINICFLOW_CLIENT_IP_SOURCE=socket` in this profile because Uvicorn has already validated the immediate proxy and rewritten `request.client`.
- Do not broaden `CLINICFLOW_TRUSTED_PROXY_IPS` to `0.0.0.0/0`, `::/0`, `*`, or an unnecessarily large network. If the Compose topology changes, review the proxy address and trust configuration together.
- Caddy terminates TLS and is the only service with public HTTP/HTTPS ports. FastAPI and PostgreSQL are reachable only on the internal backend network.
- The backend filesystem is read-only except for `/tmp`, runs as a non-root user, and uses `no-new-privileges`.
- If any existing installation already contains a PostgreSQL 17 data volume, **do not start PostgreSQL 18 against that volume in place**. Perform a separately reviewed PostgreSQL major-version upgrade using backup/restore or a supported `pg_upgrade` procedure. A fresh V1 production deployment can start directly on 18.

## Authentication protection and operational limits

Login IP budgets: 20 attempts/minute and 100/15 minutes. Identity budgets: 5 attempts/minute and 20/15 minutes, normalized with PostgreSQL `lower()` to match CITEXT and then hashed in memory. Checks reserve capacity atomically before password verification; failed transactions do not erase attempts. Successful login clears the identity budget but retains the IP budget. Refresh and password-change attempts share the IP budget. Unknown, ambiguous, disabled, and incorrect-password logins all return `INVALID_CREDENTIALS`; blocked requests return 429 with `Retry-After` and a request ID.

Budgets expire automatically, store at most 10,000 keys, and fail closed at saturation. They reset on process restart and are not shared across workers or instances. **Single-instance/single-worker operation is therefore a V1 security constraint.** Before scaling horizontally, move authentication throttling to shared atomic storage or an equivalent edge-enforced mechanism.

Application logs are JSON with request IDs, route templates, status, and duration. Unexpected failures emit operational metadata without exception text, raw paths, SQL parameters, credentials, or patient identifiers. Restrict log access and retention. Business audit data remains append-only in PostgreSQL.

## Database runtime baseline

- PostgreSQL major version: **18** for CI, Render staging/cloud, and fresh self-hosted production deployments.
- Database pool defaults per application worker: 5 connections + 5 overflow, 10-second pool wait, 1800-second recycle, 5-second connect timeout, and `pool_pre_ping=True`.
- Environment knobs are `CLINICFLOW_DB_POOL_SIZE`, `CLINICFLOW_DB_MAX_OVERFLOW`, `CLINICFLOW_DB_POOL_TIMEOUT`, `CLINICFLOW_DB_POOL_RECYCLE`, and `CLINICFLOW_DB_CONNECT_TIMEOUT`.
- Budget connections for migrations and backups in addition to the application pool.
- Do not impose an aggressive global statement timeout on financial or scheduling transactions without query-specific validation.

## Backup and restore baseline

- Run `scripts/backup_postgres.sh` on a schedule appropriate to the clinic's recovery-point objective. The script writes a PostgreSQL custom-format dump atomically with owner-only permissions, verifies its SHA-256 sidecar, and retains 7 daily, 4 weekly, and 6 monthly copies in the configured backup root.
- A `.sha256` sidecar detects accidental corruption or an incomplete/corrupted copy. Because the checksum is stored beside the dump and is not cryptographically authenticated with a separate secret, it is **not** evidence against an attacker who can modify both files. Keep production backup copies on access-controlled storage separate from the live database host, with independent credentials or permissions where practical.
- Copy backups off-host before treating them as disaster-recovery coverage. Render-managed production should use the provider's supported backup/recovery capabilities plus an independently controlled export/backup policy appropriate to the deployment; self-hosted production should keep at least one protected copy outside the application server.
- Run `scripts/verify_restore.sh <dump>` periodically and after backup/recovery changes. It verifies the sidecar, restores into a disposable database with `pg_restore --exit-on-error`, checks key schema/data markers, and drops the test database afterward. A backup that has never been restored is not considered verified recovery evidence.
- Record the timestamp, source release/commit, database migration revision, backup path/location, and restore-verification result for release-critical backups. Never overwrite an existing dump or checksum in place.
- Do not place backups inside the web-service container or another ephemeral filesystem. Protect backup media as patient data and restrict access accordingly.

## Host baseline for self-hosted production

- Supported Linux host with security updates enabled.
- Host firewall permits only required administration and HTTP/HTTPS traffic. PostgreSQL port 5432 is not opened publicly.
- SSH uses keys; disable password/root login where practical.
- Keep `infra/.env.production` outside Git with owner-only permissions (`chmod 600`).
- Keep the Android production signing key outside the repository and back it up separately.

## First self-hosted deployment

1. Copy `infra/.env.production.example` to `infra/.env.production` and replace every placeholder.
2. Generate a random `CLINICFLOW_ACCESS_TOKEN_SECRET` of at least 32 characters. The API refuses staging/production startup with a default or weak secret.
3. Validate configuration: `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml config --quiet`.
4. Build images: `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml build`.
5. Start PostgreSQL only: `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml up -d postgres`.
6. Run migrations exactly once: `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml run --rm backend alembic upgrade head`.
7. Start backend/Caddy: `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml up -d`.
8. Schedule daily housekeeping with `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml run --rm backend python -m scripts.housekeeping`; it removes only expired idempotency records.
9. Verify `/health/live` and `/health/ready` through the HTTPS domain.
10. Bootstrap the initial Owner using the documented backend bootstrap command, then change the temporary credential immediately.
11. Perform a real-device smoke test: login, patient search, booking, check-in, payment, receipt, completion, and logout.

## Routine deployment

1. Take and verify a database backup and record the backup path/time.
2. Pull/review the intended release and record the Git commit.
3. Confirm CI is green for backend, mobile, and production infrastructure validation.
4. Build/deploy the new backend image.
5. Run `alembic upgrade head` as a single release step or supported pre-deploy command. Do not make application startup run migrations.
6. Wait for readiness and verify the deployed commit/version metadata.
7. Smoke-test authentication and one safe read path before clinic operations continue.
8. If application code must be rolled back, keep the database at the migrated revision unless a separately reviewed data-safe downgrade exists. Never blindly downgrade patient or financial migrations.

## Incident basics

- A failing readiness check means the backend should not be considered available.
- Preserve request IDs from user-visible failures and correlate them with backend logs and audit records.
- Never repair confirmed financial history with direct SQL updates. Use ClinicFlow correction/VOID workflows.
- Never edit or delete audit rows.
- If database integrity or a deployment is uncertain, stop writes before attempting recovery.
- Treat authentication throttling failures or a loss of correct client-IP attribution as a security incident, not only an availability issue.
