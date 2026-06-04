#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/approval-app}"
ENV_FILE="${APP_ENV_FILE:-${APP_ROOT}/env/production.env}"
BACKUP_DIR="${BACKUP_DIR:-${APP_ROOT}/backups}"
CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-approval-postgres}"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-psa_admin}"
POSTGRES_USER="${POSTGRES_USER//$'\r'/}"
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

timestamp="$(date +%F-%H%M%S)"
target="${BACKUP_DIR}/postgres-${timestamp}.sql"

docker exec "${CONTAINER_NAME}" pg_dumpall -U "${POSTGRES_USER}" > "${target}"
chmod 600 "${target}"

echo "Backup written: ${target}"
