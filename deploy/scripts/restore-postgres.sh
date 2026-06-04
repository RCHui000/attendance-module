#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /opt/approval-app/backups/postgres-YYYY-MM-DD-HHMMSS.sql" >&2
  exit 1
fi

APP_ROOT="${APP_ROOT:-/opt/approval-app}"
ENV_FILE="${APP_ENV_FILE:-${APP_ROOT}/env/production.env}"
CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-approval-postgres}"
BACKUP_FILE="$1"

if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-psa_admin}"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

echo "This will restore into ${CONTAINER_NAME}. Current data may be overwritten."
echo "Press Ctrl+C within 10 seconds to abort."
sleep 10

docker exec -i "${CONTAINER_NAME}" psql -U "${POSTGRES_USER}" -d postgres < "${BACKUP_FILE}"

echo "Restore completed from: ${BACKUP_FILE}"
