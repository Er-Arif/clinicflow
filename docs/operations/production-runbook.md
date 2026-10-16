# ClinicFlow V1 — Production Runbook

## Production boundary

Production is internet-first: Android uses HTTPS to reach FastAPI and PostgreSQL remains private. Railway is the initial cloud target; the Caddy/Compose topology is an alternative self-hosted deployment. PostgreSQL has no public host port in the production Compose file.

Current implementation and validation evidence: [V1 production readiness](../release/v1-production-readiness.md). Earlier milestone counts are historical evidence, not the current release gate.

## Railway deployment

- Set service root to `backend` and use its Dockerfile. Build with the committed `uv.lock`; do not regenerate it on deployment.
- Start command: `python -m scripts.serve`. It binds `0.0.0.0:$PORT` (8000 when unset), disables raw Uvicorn access logs, and forces one worker. Use exactly **one replica** while auth budgets are process-local.
- Set `CLINICFLOW_ENVIRONMENT=production`, a random access secret of at least 32 characters, and a non-placeholder `CLINICFLOW_DATABASE_URL` using `postgresql+psycopg://`. URL-encode the password. Use Railway private networking; when the chosen database endpoint requires TLS, specify `?sslmode=require` or preferably `verify-full` with the provider CA. Never expose PostgreSQL merely to make the app reachable.
- Set `CLINICFLOW_ALLOWED_HOSTS` to a JSON array containing the public API hostname and `healthcheck.railway.app` (plus any explicitly used private health host). Set `CLINICFLOW_CORS_ORIGINS=[]` for the native-only client; if a browser client is deployed, list only its exact HTTPS origins. CORS credentials are disabled: authentication uses Bearer headers and refresh-token request bodies, not cookies. Cookie SameSite/CSRF settings do not apply to this architecture.
- On Railway public HTTP ingress, set `CLINICFLOW_CLIENT_IP_SOURCE=railway` and keep `CLINICFLOW_TRUSTED_PROXY_IPS=[]`. ClinicFlow then reads Railway's edge-supplied `X-Real-IP` for auth IP throttling and does not trust `X-Forwarded-For`. Missing or malformed `X-Real-IP` fails closed to the shared `unknown` throttle bucket. For non-Railway/self-hosted deployments, keep `CLINICFLOW_CLIENT_IP_SOURCE=socket` unless an explicitly reviewed proxy-trust configuration is in place. Never trust arbitrary forwarded headers or all-address proxy CIDRs. Verify real client-IP behavior and spoof resistance through the deployed ingress before clinic rollout.
- Run `alembic upgrade head` as the separately configured pre-deploy command, serialized by the deployment operator. Do not launch overlapping deployments or place migrations in per-worker startup. This pass adds no migration.
- Healthcheck path: `/health/ready`. `/health/live` checks the process; readiness executes `SELECT 1` and returns a safe 503 on database failure. It does not certify schema compatibility or domain data. Run migration and smoke checks separately.
- Configure restart-on-failure and alerts for failed deploys, sustained 5xx/503, restart loops and backup failures. Railway deploy healthchecks are not a continuous uptime monitor; arrange an external probe before clinic rollout. No monitoring vendor is installed by this pass.
- Database pool defaults per worker: 5 connections + 5 overflow, 10-second pool wait, 1800-second recycle, 5-second connect timeout, `pool_pre_ping=True`. Environment knobs are `CLINICFLOW_DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT`, `DB_POOL_RECYCLE`, `DB_CONNECT_TIMEOUT` (all with the `CLINICFLOW_` prefix). Budget database connections for migrations/backup too. No aggressive statement timeout is imposed on financial/scheduling transactions.

Reference: [Railway healthchecks](https://docs.railway.com/deployments/healthchecks), [pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command), [Uvicorn proxy trust](https://uvicorn.dev/settings/).

## Login protection and operational limits

Login IP budgets: 20 attempts/minute and 100/15 minutes. Identity budgets: 5 attempts/minute and 20/15 minutes, normalized with PostgreSQL `lower()` to match CITEXT, then hashed in memory. Checks reserve capacity atomically before password verification; failed transactions do not erase attempts. Successful login clears the identity budget but retains the IP budget. Refresh and password-change attempts share the IP budget. Unknown, ambiguous, disabled and incorrect-password logins all return `INVALID_CREDENTIALS`; blocked requests return 429 with `Retry-After` and a request ID.

Budgets expire automatically, store at most 10,000 keys and fail closed at saturation. They reset on restart and are not shared across replicas; deployment overlap also temporarily divides enforcement. This is an accepted single-instance V1 constraint, not distributed protection. Before scaling, review shared atomic storage/edge protection as a separate change. Distributed denial-of-service protection remains an ingress responsibility. Logs contain throttling event/request ID, never login identifiers, passwords or tokens.

Application logs are JSON with request IDs, route templates, status and duration; startup/shutdown and unexpected-error events are recorded. Raw query strings, arbitrary paths, SQL parameters and exception messages are excluded. Restrict log access and retention; business audit data remains in PostgreSQL, unchanged.

## Host baseline

- Supported Linux host with security updates enabled.
- Host firewall permits only administrative SSH and HTTP/HTTPS. PostgreSQL port 5432 is not opened.
- SSH uses keys; disable password login/root login where practical.
- Keep `/infra/.env.production` outside Git with owner-only permissions (`chmod 600`).
- Keep the production Android signing key outside the repository and back it up separately.

## First deployment

1. Copy `infra/.env.production.example` to `infra/.env.production` and replace every placeholder.
2. Generate a random `CLINICFLOW_ACCESS_TOKEN_SECRET` of at least 32 characters. The API refuses staging/production startup with a default/weak secret.
3. Build images: `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml build`.
4. Start PostgreSQL only: `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml up -d postgres`.
5. Run migrations exactly once: `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml run --rm backend alembic upgrade head`.
6. Start backend/Caddy: `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml up -d`.
7. Schedule daily housekeeping with `docker compose --env-file infra/.env.production -f infra/docker-compose.production.yml run --rm backend python -m scripts.housekeeping`; it removes only expired idempotency records.
8. Verify `/health/live` and `/health/ready` through the HTTPS domain.
9. Bootstrap the initial Owner using the documented backend bootstrap command, then change the temporary credential immediately.
10. Perform a real-device smoke test: login, patient search, booking, check-in, payment, receipt, completion, and logout.

## Routine deployment

1. Run `scripts/backup_postgres.sh` and retain its reported backup path.
2. Pull/review the intended release and record the Git commit.
3. Build the new backend image.
4. Run `alembic upgrade head` as a separate one-shot command. Do not make application startup run migrations.
5. Replace/start backend and wait for readiness.
6. Smoke-test authentication and one safe read path before clinic operations continue.
7. If application code must be rolled back, keep the database at the migrated revision unless a separately reviewed data-safe downgrade exists. Do not blindly downgrade patient/financial migrations.

## Incident basics

- A failing readiness check means the backend should not be considered available.
- Preserve request IDs from user-visible failures and correlate them with backend logs/audit records.
- Never repair confirmed financial history with direct SQL updates. Use ClinicFlow correction/VOID workflows.
- Never edit or delete audit rows.
- If database integrity or a deployment is uncertain, stop writes before attempting recovery.
