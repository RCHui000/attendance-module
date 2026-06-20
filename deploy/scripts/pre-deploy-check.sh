#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/approval-app}"
APP_CODE_DIR="${APP_CODE_DIR:-${APP_ROOT}/app}"
ENV_FILE="${ENV_FILE:-${APP_ENV_FILE:-${APP_ROOT}/env/production.env}}"
COMPOSE_FILE="${COMPOSE_FILE:-${APP_CODE_DIR}/docker-compose.aliyun.yml}"
APP_URL="${APP_URL:-https://xpjs.asia}"
REST_URL="${REST_URL:-${APP_URL%/}/rest/v1}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-approval-app}"
POSTGRES_CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-approval-postgres}"
ASSERT_GRANTS_SQL="${ASSERT_GRANTS_SQL:-${APP_CODE_DIR}/scripts/assert-function-grants.sql}"
CURL_CONNECT_TIMEOUT="${CURL_CONNECT_TIMEOUT:-5}"
CURL_MAX_TIME="${CURL_MAX_TIME:-20}"
PYTHON_BIN="${PYTHON_BIN:-}"

if [[ "${COMPOSE_FILE}" != /* ]]; then
  COMPOSE_FILE="${APP_CODE_DIR}/${COMPOSE_FILE}"
fi

if [[ "${ASSERT_GRANTS_SQL}" != /* ]]; then
  ASSERT_GRANTS_SQL="${APP_CODE_DIR}/${ASSERT_GRANTS_SQL}"
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

info() {
  echo "== $* =="
}

ok() {
  echo "[OK] $*"
}

die() {
  echo "[FAIL] $*" >&2
  exit 1
}

strip_cr() {
  local value="${1:-}"
  printf '%s' "${value//$'\r'/}"
}

if [ -z "${PYTHON_BIN}" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
  else
    die "Missing python3/python; cannot generate test JWT."
  fi
fi

if [ ! -f "${ENV_FILE}" ]; then
  die "Missing environment file: ${ENV_FILE}"
fi

if [ ! -f "${COMPOSE_FILE}" ]; then
  die "Missing compose file: ${COMPOSE_FILE}"
fi

info "Verify JWT keys"
ENV_FILE="${ENV_FILE}" PYTHON_BIN="${PYTHON_BIN}" bash "${SCRIPT_DIR}/verify-jwt-keys.sh"

set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a

ANON_KEY="$(strip_cr "${ANON_KEY:-}")"
JWT_SECRET="$(strip_cr "${JWT_SECRET:-}")"
POSTGRES_USER="$(strip_cr "${POSTGRES_USER:-psa_admin}")"
POSTGRES_DB="$(strip_cr "${POSTGRES_DB:-psa}")"

if [ -z "${ANON_KEY}" ]; then
  die "ANON_KEY is missing after loading ${ENV_FILE}"
fi
if [ -z "${JWT_SECRET}" ]; then
  die "JWT_SECRET is missing after loading ${ENV_FILE}"
fi

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

info "Compose service status"
compose ps -a || die "docker compose ps failed."

check_service() {
  local service="$1"
  local require_health="$2"
  local cid
  local inspect
  local runtime
  local health
  local container_name

  cid="$(compose ps -a -q "${service}" 2>/dev/null || true)"
  if [ -z "${cid}" ]; then
    die "Compose service '${service}' has no container."
  fi

  inspect="$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Name}}' "${cid}")" \
    || die "Failed to inspect compose service '${service}'."
  IFS='|' read -r runtime health container_name <<<"${inspect}"

  if [ "${runtime}" != "running" ]; then
    die "Compose service '${service}' is ${runtime:-unknown} (${container_name#/})."
  fi

  if [ "${require_health}" = "yes" ] && [ -n "${health}" ] && [ "${health}" != "healthy" ]; then
    die "Compose service '${service}' health is ${health} (${container_name#/})."
  fi

  if [ "${require_health}" = "yes" ] && [ -n "${health}" ]; then
    ok "${service} is running/${health}"
  else
    ok "${service} is running"
  fi
}

check_service "app" "yes"
check_service "postgres" "yes"
check_service "postgrest" "no"
check_service "nginx" "yes"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

body_preview() {
  local file="$1"
  tr '\n' ' ' <"${file}" | cut -c1-300
}

info "HTTP homepage"
HOME_BODY="${TMP_DIR}/home.html"
if ! home_status="$(
  curl -sS -L \
    --connect-timeout "${CURL_CONNECT_TIMEOUT}" \
    --max-time "${CURL_MAX_TIME}" \
    -o "${HOME_BODY}" \
    -w '%{http_code}' \
    "${APP_URL%/}/"
)"; then
  die "Homepage curl failed for ${APP_URL%/}/."
fi
if [ "${home_status}" != "200" ]; then
  die "Homepage returned HTTP ${home_status}; expected 200."
fi
ok "Homepage returned HTTP 200 from ${APP_URL%/}/"

if [ -n "${EXPECTED_VERSION:-}" ]; then
  info "Version check"
  if grep -F -q -- "${EXPECTED_VERSION}" "${HOME_BODY}"; then
    ok "EXPECTED_VERSION found in homepage HTML."
  elif docker exec -e EXPECTED_VERSION="${EXPECTED_VERSION}" "${APP_CONTAINER_NAME}" \
    sh -c 'grep -R -F -q -- "$EXPECTED_VERSION" /app 2>/dev/null'; then
    ok "EXPECTED_VERSION found in app dist bundle."
  else
    die "EXPECTED_VERSION='${EXPECTED_VERSION}' was not found in homepage HTML or /app dist bundle."
  fi
fi

post_rpc() {
  local rpc_name="$1"
  local bearer_token="$2"
  local request_body="$3"
  local output_file="$4"

  curl -sS -L --post301 --post302 --post303 \
    --connect-timeout "${CURL_CONNECT_TIMEOUT}" \
    --max-time "${CURL_MAX_TIME}" \
    -o "${output_file}" \
    -w '%{http_code}' \
    -X POST \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${bearer_token}" \
    -H "Content-Type: application/json" \
    --data "${request_body}" \
    "${REST_URL%/}/rpc/${rpc_name}"
}

info "Anonymous login resolver RPC"
resolve_body="${TMP_DIR}/psa_resolve_login_email.json"
if ! resolve_status="$(post_rpc "psa_resolve_login_email" "${ANON_KEY}" '{"p_login":"__pre_deploy_check__"}' "${resolve_body}")"; then
  die "curl failed for psa_resolve_login_email."
fi
if [ "${resolve_status}" != "200" ]; then
  die "psa_resolve_login_email returned HTTP ${resolve_status}; expected 200. Body: $(body_preview "${resolve_body}")"
fi
ok "psa_resolve_login_email returned HTTP 200 with ANON_KEY."

info "Auth token endpoint goes through guarded app proxy"
auth_guard_body="${TMP_DIR}/auth_guard.json"
if ! auth_guard_status="$(
  curl -sS -L \
    --connect-timeout "${CURL_CONNECT_TIMEOUT}" \
    --max-time "${CURL_MAX_TIME}" \
    -o "${auth_guard_body}" \
    -w '%{http_code}' \
    -X POST \
    -H "Content-Type: application/json" \
    --data '{"email":"__pre_deploy_check__@psa.local","password":"wrong","gotrue_meta_security":{}}' \
    "${APP_URL%/}/auth/token?grant_type=password"
)"; then
  die "curl failed for guarded /auth/token endpoint."
fi
if [ "${auth_guard_status}" != "400" ] && [ "${auth_guard_status}" != "403" ]; then
  die "/auth/token returned HTTP ${auth_guard_status}; expected 400 or 403. Body: $(body_preview "${auth_guard_body}")"
fi
ok "/auth/token is reachable only through the guarded public path."

psql_at() {
  local sql="$1"
  docker exec -i "${POSTGRES_CONTAINER_NAME}" \
    psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Atc "${sql}"
}

info "Generate short-lived authenticated JWT"
if ! AUTH_USER_ID="$(psql_at "SELECT auth_user_id::text FROM public.employees WHERE auth_user_id IS NOT NULL LIMIT 1;" | tr -d '\r')"; then
  die "Failed to query employees.auth_user_id from ${POSTGRES_CONTAINER_NAME}."
fi
if [ -z "${AUTH_USER_ID}" ]; then
  die "No employees.auth_user_id value found; cannot run authenticated RPC checks."
fi

if ! AUTH_JWT="$(
  JWT_SECRET="${JWT_SECRET}" AUTH_USER_ID="${AUTH_USER_ID}" "${PYTHON_BIN}" - <<'PY'
import base64
import hashlib
import hmac
import json
import os
import time


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


now = int(time.time())
header = {"alg": "HS256", "typ": "JWT"}
payload = {
    "aud": "authenticated",
    "exp": now + 300,
    "iat": now,
    "iss": "supabase",
    "role": "authenticated",
    "sub": os.environ["AUTH_USER_ID"],
}
head = b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
body = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
signature = hmac.new(os.environ["JWT_SECRET"].encode("utf-8"), f"{head}.{body}".encode("ascii"), hashlib.sha256).digest()
print(f"{head}.{body}.{b64url(signature)}")
PY
)"; then
  die "Failed to generate short-lived authenticated JWT."
fi
ok "Generated short-lived authenticated JWT from one employees.auth_user_id."

info "Direct approve_node RPC must be blocked"
approve_body="${TMP_DIR}/approve_node.json"
if ! approve_status="$(post_rpc "approve_node" "${AUTH_JWT}" '{"p_node_id":0,"p_actor_user_id":0,"p_comment":"pre-deploy-check","p_request_id":"pre-deploy-check"}' "${approve_body}")"; then
  die "curl failed for approve_node."
fi
if [ "${approve_status}" != "403" ]; then
  die "approve_node returned HTTP ${approve_status}; expected 403. Body: $(body_preview "${approve_body}")"
fi
ok "approve_node direct RPC returned HTTP 403."

info "psa_timesheet_action missing id behavior"
timesheet_body="${TMP_DIR}/psa_timesheet_action.json"
if ! timesheet_status="$(post_rpc "psa_timesheet_action" "${AUTH_JWT}" '{"p_timesheet_id":-1,"p_action":"submit","p_comment":"pre-deploy-check","p_task_id":null}' "${timesheet_body}")"; then
  die "curl failed for psa_timesheet_action."
fi
if [ "${timesheet_status}" != "400" ]; then
  die "psa_timesheet_action returned HTTP ${timesheet_status}; expected 400. Body: $(body_preview "${timesheet_body}")"
fi
if ! grep -F -q "Timesheet not found" "${timesheet_body}"; then
  die "psa_timesheet_action HTTP 400 did not include 'Timesheet not found'. Body: $(body_preview "${timesheet_body}")"
fi
ok "psa_timesheet_action invalid id returned HTTP 400 with expected message."

if [ -f "${ASSERT_GRANTS_SQL}" ]; then
  info "Function grant assertions"
  docker exec -i "${POSTGRES_CONTAINER_NAME}" \
    psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
    <"${ASSERT_GRANTS_SQL}"
  ok "Ran ${ASSERT_GRANTS_SQL}."
else
  ok "Skipped function grant assertions; file not found: ${ASSERT_GRANTS_SQL}"
fi

info "Pre-deploy check summary"
ok "JWT keys, compose services, homepage, public RPC, authenticated RPC guards, and optional grants check completed."
