# ClinicFlow V1 — Backup & Restore

ClinicFlow's production baseline is 7 daily, 4 weekly, and 6 monthly PostgreSQL backups.

`scripts/backup_postgres.sh` creates a PostgreSQL custom-format dump, SHA-256 checksum, and rotating daily/weekly/monthly copies. The live database volume and backup storage must not be the only two copies on the same physical disk. Copy backups to separate protected storage; encrypt backups before any off-host/cloud transfer.

## Automated backup

Run from a protected system timer/cron account, for example once nightly after clinic hours. Monitor the exit code and alert on failure. A silent backup job is not a backup strategy.

## Verify restore

Run periodically:

```text
scripts/verify_restore.sh backups/daily/clinicflow-YYYYMMDDTHHMMSSZ.dump
```

The script creates a temporary database in the PostgreSQL container, restores the dump with `--exit-on-error`, checks the Alembic revision and core tables, then drops the temporary database. It never restores over the live ClinicFlow database.

## Disaster restore

1. Stop ClinicFlow writes.
2. Preserve the failed database/volume for investigation where possible.
3. Provision a clean PostgreSQL instance at a compatible major version.
4. Verify the chosen backup checksum.
5. Restore using `pg_restore --exit-on-error` into a clean database.
6. Confirm `alembic_version`, clinic/user counts, appointment/visit/payment/receipt counts, and latest audit timestamps.
7. Start the backend against the restored database and pass readiness/smoke checks before reopening clinic operations.
