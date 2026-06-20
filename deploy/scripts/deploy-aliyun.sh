#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/approval-app}"
APP_CODE_DIR="${APP_CODE_DIR:-${APP_ROOT}/app}"
ENV_FILE="${APP_ENV_FILE:-${APP_ROOT}/env/production.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.aliyun.yml}"

cd "${APP_CODE_DIR}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing environment file: ${ENV_FILE}" >&2
  echo "Create it from .env.production.example and fill real secrets before deploy." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

if [ -d .git ]; then
  echo "== Pull latest code =="
  git pull --ff-only
else
  echo "== Skip git pull: ${APP_CODE_DIR} is not a git checkout =="
fi

echo "== Build frontend =="
if [ "${SKIP_FRONTEND_BUILD:-0}" = "1" ]; then
  if [ ! -f frontend/dist/index.html ]; then
    echo "SKIP_FRONTEND_BUILD=1 but frontend/dist/index.html is missing." >&2
    exit 1
  fi
  echo "Skip frontend build and use existing frontend/dist."
elif command -v npm >/dev/null 2>&1; then
  npm --prefix frontend ci
  npm --prefix frontend run build
elif [ -f frontend/dist/index.html ]; then
  echo "npm not found; use existing frontend/dist."
else
  echo "npm is not installed and frontend/dist/index.html is missing." >&2
  echo "Build frontend locally, sync frontend/dist, then rerun with SKIP_FRONTEND_BUILD=1." >&2
  exit 1
fi

echo "== Frontend quality check =="
if command -v npm >/dev/null 2>&1; then
  npm --prefix frontend run lint
  npm --prefix frontend audit --audit-level=high
elif [ "${SKIP_FRONTEND_BUILD:-0}" = "1" ]; then
  echo "npm not found; skipping frontend quality check because SKIP_FRONTEND_BUILD=1 and prebuilt dist is expected."
else
  echo "npm not found; cannot run frontend quality check." >&2
  exit 1
fi

echo "== Build and start containers =="
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d

echo "== Apply database migrations =="
POSTGRES_CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-approval-postgres}" \
POSTGRES_USER="${POSTGRES_USER:-psa_admin}" \
POSTGRES_DB="${POSTGRES_DB:-psa}" \
  bash deploy/scripts/apply-migrations.sh

echo "== Apply GoTrue compatibility views =="
docker exec -i "${POSTGRES_CONTAINER_NAME:-approval-postgres}" \
  psql -U "${POSTGRES_USER:-psa_admin}" -d "${POSTGRES_DB:-psa}" \
  < deploy/sql/gotrue-public-compat.sql

echo "== Post-deploy verification =="
bash deploy/scripts/pre-deploy-check.sh

echo "== Container status =="
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "== Recent logs =="
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=100
