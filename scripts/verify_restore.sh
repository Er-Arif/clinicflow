#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/clinicflow-backup.dump" >&2
  exit 2
fi

BACKUP_FILE=$1
[ -r "$BACKUP_FILE" ] || { echo "Backup is not readable: $BACKUP_FILE" >&2; exit 1; }

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python3 "$ROOT_DIR/scripts/backup_integrity.py" verify "$BACKUP_FILE"
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT_DIR/infra/docker-compose.production.yml"}
ENV_FILE=${ENV_FILE:-"$ROOT_DIR/infra/.env.production"}

# shellcheck disable=SC1090
BACKUP_MODE=${BACKUP_MODE:-compose}
case "$BACKUP_MODE" in
  compose)
    set -a
    . "$ENV_FILE"
    set +a
    : "${POSTGRES_USER:?POSTGRES_USER is required}"
    ;;
  direct)
    : "${PGHOST:?PGHOST is required}"
    : "${PGUSER:?PGUSER is required}"
    POSTGRES_USER=$PGUSER
    ;;
  *) echo "Invalid BACKUP_MODE" >&2; exit 2;;
esac
pg_run() {
  if [ "$BACKUP_MODE" = compose ]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres "$@"
  else
    "$@"
  fi
}
TEST_DB="clinicflow_restore_$(date -u +%Y%m%d%H%M%S)_$$"

cleanup() {
  pg_run \
    dropdb -U "$POSTGRES_USER" --if-exists "$TEST_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
pg_run \
  createdb -U "$POSTGRES_USER" "$TEST_DB"
pg_run pg_restore -U "$POSTGRES_USER" -d "$TEST_DB" --no-owner --no-privileges --exit-on-error < "$BACKUP_FILE"

pg_run \
  psql -U "$POSTGRES_USER" -d "$TEST_DB" -v ON_ERROR_STOP=1 -Atc \
  "SELECT 'alembic=' || version_num FROM alembic_version; SELECT 'clinics=' || count(*) FROM clinics; SELECT 'audit=' || count(*) FROM audit_events;"

echo "Restore verification succeeded: $BACKUP_FILE"
