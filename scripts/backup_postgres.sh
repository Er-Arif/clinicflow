#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT_DIR/infra/docker-compose.production.yml"}
ENV_FILE=${ENV_FILE:-"$ROOT_DIR/infra/.env.production"}
BACKUP_ROOT=${BACKUP_ROOT:-"$ROOT_DIR/backups"}

if [ ! -f "$ENV_FILE" ]; then
  echo "Production env file not found: $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DAY=$(date -u +%d)
WEEKDAY=$(date -u +%u)
DAILY_DIR="$BACKUP_ROOT/daily"
WEEKLY_DIR="$BACKUP_ROOT/weekly"
MONTHLY_DIR="$BACKUP_ROOT/monthly"
mkdir -p "$DAILY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR"
chmod 700 "$BACKUP_ROOT" "$DAILY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR"

FILE="$DAILY_DIR/clinicflow-$STAMP.dump"
TMP="$FILE.tmp"
trap 'rm -f "$TMP"' EXIT INT TERM

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges > "$TMP"

[ -s "$TMP" ] || { echo "Backup is empty" >&2; exit 1; }
mv "$TMP" "$FILE"
chmod 600 "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
chmod 600 "$FILE.sha256"
trap - EXIT INT TERM

if [ "$WEEKDAY" = "7" ]; then
  cp -p "$FILE" "$WEEKLY_DIR/"
  cp -p "$FILE.sha256" "$WEEKLY_DIR/"
fi
if [ "$DAY" = "01" ]; then
  cp -p "$FILE" "$MONTHLY_DIR/"
  cp -p "$FILE.sha256" "$MONTHLY_DIR/"
fi

prune_count() {
  dir=$1
  keep=$2
  # Backup names contain no spaces; remove dumps beyond the requested count and their checksums.
  count=0
  for item in $(find "$dir" -maxdepth 1 -type f -name 'clinicflow-*.dump' -printf '%f\n' | sort -r); do
    count=$((count + 1))
    if [ "$count" -gt "$keep" ]; then
      rm -f "$dir/$item" "$dir/$item.sha256"
    fi
  done
}

prune_count "$DAILY_DIR" 7
prune_count "$WEEKLY_DIR" 4
prune_count "$MONTHLY_DIR" 6

echo "$FILE"
