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

echo "== Pull latest code =="
git pull --ff-only

echo "== Build frontend =="
npm --prefix frontend ci
npm --prefix frontend run build

echo "== Build and start containers =="
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d

echo "== Container status =="
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps

echo "== Recent logs =="
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=100
