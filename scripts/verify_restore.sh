#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/clinicflow-backup.dump" >&2
  exit 2
fi

BACKUP_FILE=$1
[ -r "$BACKUP_FILE" ] || { echo "Backup is not readable: $BACKUP_FILE" >&2; exit 1; }

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT_DIR/infra/docker-compose.production.yml"}
ENV_FILE=${ENV_FILE:-"$ROOT_DIR/infra/.env.production"}

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

: "${POSTGRES_USER:?POSTGRES_USER is required}"
TEST_DB="clinicflow_restore_$(date -u +%Y%m%d%H%M%S)_$$"

cleanup() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    dropdb -U "$POSTGRES_USER" --if-exists "$TEST_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  createdb -U "$POSTGRES_USER" "$TEST_DB"
cat "$BACKUP_FILE" | docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$TEST_DB" --no-owner --no-privileges --exit-on-error

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$TEST_DB" -v ON_ERROR_STOP=1 -Atc \
  "SELECT 'alembic=' || version_num FROM alembic_version; SELECT 'clinics=' || count(*) FROM clinics; SELECT 'audit=' || count(*) FROM audit_events;"

echo "Restore verification succeeded: $BACKUP_FILE"
