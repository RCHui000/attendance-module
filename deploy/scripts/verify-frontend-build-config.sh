#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/approval-app}"
ENV_FILE="${ENV_FILE:-${APP_ENV_FILE:-${APP_ROOT}/env/production.env}}"
DIST_DIR="${DIST_DIR:-${APP_ROOT}/app/frontend/dist}"

die() {
  echo "Frontend build config check failed: $*" >&2
  exit 1
}

strip_cr() {
  local value="${1:-}"
  printf '%s' "${value//$'\r'/}"
}

[ -f "${ENV_FILE}" ] || die "missing environment file ${ENV_FILE}"
[ -d "${DIST_DIR}" ] || die "missing frontend dist directory ${DIST_DIR}"

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

ANON_KEY="$(strip_cr "${ANON_KEY:-}")"
FRONTEND_ANON_KEY="$(strip_cr "${VITE_SUPABASE_ANON_KEY:-}")"

[ -n "${FRONTEND_ANON_KEY}" ] || die "VITE_SUPABASE_ANON_KEY is empty"
if [ -n "${ANON_KEY}" ] && [ "${FRONTEND_ANON_KEY}" != "${ANON_KEY}" ]; then
  die "VITE_SUPABASE_ANON_KEY does not match ANON_KEY"
fi

grep -R -F -q -- "${FRONTEND_ANON_KEY}" "${DIST_DIR}" \
  || die "VITE_SUPABASE_ANON_KEY is not embedded in frontend dist"

if grep -R -F -q -- '__PSA_SUPABASE_ANON_KEY__' "${DIST_DIR}"; then
  die "unresolved Supabase key placeholder remains in frontend dist"
fi

echo "Frontend build config check passed."
