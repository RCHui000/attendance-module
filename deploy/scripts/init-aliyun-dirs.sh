#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/approval-app}"

mkdir -p \
  "${APP_ROOT}/app" \
  "${APP_ROOT}/data/postgres" \
  "${APP_ROOT}/backups" \
  "${APP_ROOT}/logs" \
  "${APP_ROOT}/nginx/certbot/www" \
  "${APP_ROOT}/nginx/letsencrypt" \
  "${APP_ROOT}/env"

chmod 700 "${APP_ROOT}/env"
chmod 700 "${APP_ROOT}/backups"

echo "Initialized Aliyun directories under ${APP_ROOT}"
