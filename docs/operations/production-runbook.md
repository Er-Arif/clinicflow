# ClinicFlow V1 — Production Runbook

## Production boundary

Production uses Caddy → FastAPI → PostgreSQL. PostgreSQL has no host/public port in the production Compose file. Caddy is the only public service and terminates HTTPS. FastAPI and PostgreSQL communicate on an internal Docker network.

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
