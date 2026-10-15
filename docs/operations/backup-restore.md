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

The scripts require POSIX shell, Python 3.10+, and either Docker Compose or compatible PostgreSQL client tools. Sidecars contain a SHA-256 digest and the dump basename, so daily/weekly/monthly copies remain independently verifiable after the daily copy is pruned. Restore verifies the exact requested artifact **before creating any database**; a missing/malformed/mismatching sidecar fails nonzero. Older absolute-path sidecars must be independently verified at their original path before an operator converts them; do not blindly regenerate a checksum to bless an untrusted backup.

## Railway / direct PostgreSQL

Use `BACKUP_MODE=direct` with `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, and provider-appropriate `PGSSLMODE`. Supply credentials through a protected `PGPASSFILE` (0600) or secret-injected `PGPASSWORD`; never paste credentials in command arguments or commit them. Use a matching PostgreSQL client major version. Execute from a trusted host/job with access to the private database or an explicitly secured provider connection.

```sh
BACKUP_MODE=direct BACKUP_ROOT=/protected/clinicflow-backups sh scripts/backup_postgres.sh
BACKUP_MODE=direct sh scripts/verify_restore.sh /protected/clinicflow-backups/daily/clinicflow-TIMESTAMP-PID.dump
```

Direct restore verification requires permission to create/drop its uniquely named disposable database. Prefer an isolated restore instance. The script changes no live database. Verify business counts (appointments, visits, payments, receipts), latest audit timestamps, and known sample receipts against an independently recorded baseline before accepting a disaster recovery. A checksum proves byte integrity, not completeness or successful recovery.

No scheduler/service is provisioned by this repository. Assign an operator to schedule backups, monitor nonzero exits and stale/missing artifacts, maintain 7/4/6 retention, protect encrypted off-host copies and perform a recurring restore drill. Keep encryption keys separate. Keep the dump and sidecar together. A failed checksum creation is an unsuccessful backup even if a dump exists.

## Disaster restore

1. Stop ClinicFlow writes.
2. Preserve the failed database/volume for investigation where possible.
3. Provision a clean PostgreSQL instance at a compatible major version.
4. Verify the chosen backup checksum.
5. Restore using `pg_restore --exit-on-error` into a clean database.
6. Confirm `alembic_version`, clinic/user counts, appointment/visit/payment/receipt counts, and latest audit timestamps.
7. Start the backend against the restored database and pass readiness/smoke checks before reopening clinic operations.
