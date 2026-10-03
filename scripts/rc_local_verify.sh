#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

[ -f "$ROOT_DIR/backend/uv.lock" ] || {
  echo "backend/uv.lock is missing. Run 'cd backend && uv lock' online, review it, and commit it before RC." >&2
  exit 1
}
[ -f "$ROOT_DIR/mobile/package-lock.json" ] || {
  echo "mobile/package-lock.json is missing. Run 'cd mobile && npm install', review it, and commit it before RC." >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || { echo "Docker is required for RC verification." >&2; exit 1; }
command -v uv >/dev/null 2>&1 || { echo "uv is required for RC verification." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required for RC verification." >&2; exit 1; }

COMPOSE="$ROOT_DIR/infra/docker-compose.yml"
TEST_DB="clinicflow_rc_test"
DB_URL="postgresql+psycopg://clinicflow:clinicflow@localhost:5432/$TEST_DB"

cleanup() {
  docker compose -f "$COMPOSE" exec -T postgres \
    dropdb -U clinicflow --if-exists "$TEST_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose -f "$COMPOSE" up -d postgres
cleanup
docker compose -f "$COMPOSE" exec -T postgres createdb -U clinicflow "$TEST_DB"

(
  cd "$ROOT_DIR/backend"
  uv sync --frozen --dev
  CLINICFLOW_DATABASE_URL="$DB_URL" uv run alembic upgrade head
  CLINICFLOW_DATABASE_URL="$DB_URL" CLINICFLOW_RUN_INTEGRATION=1 uv run ruff check .
  CLINICFLOW_DATABASE_URL="$DB_URL" CLINICFLOW_RUN_INTEGRATION=1 uv run pytest
)

(
  cd "$ROOT_DIR/mobile"
  npm ci
  npm run lint
  npm run typecheck
)

echo "ClinicFlow local RC verification passed. Physical Android-device UAT is still required."
