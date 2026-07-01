#!/usr/bin/env bash
set -euo pipefail

APP_URL="${APP_URL:-https://xpjs.asia}"
API_BASE="${NAS_SYNC_API_BASE:-${APP_URL%/}/api/nas-sync}"
NAS_SYNC_TOKEN="${NAS_SYNC_TOKEN:-}"
POSTGRES_CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-approval-postgres}"
POSTGRES_USER="${POSTGRES_USER:-psa_admin}"
POSTGRES_DB="${POSTGRES_DB:-psa}"
RUN_MUTATION_SMOKE="${NAS_SYNC_RUN_MUTATION_SMOKE:-0}"

if [ -z "${NAS_SYNC_TOKEN}" ]; then
  echo "NAS_SYNC_TOKEN is required for NAS sync smoke checks." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  if [ "${RUN_MUTATION_SMOKE}" = "1" ] && command -v docker >/dev/null 2>&1; then
    docker exec -i "${POSTGRES_CONTAINER_NAME}" \
      psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null <<'SQL' || true
DELETE FROM public.nas_sync_events WHERE employee_id IN (990010001, 990010002);
DELETE FROM public.employees WHERE id IN (990010001, 990010002);
SQL
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

body_preview() {
  tr '\n' ' ' <"$1" | cut -c1-300
}

request() {
  local method="$1"
  local url="$2"
  local output="$3"
  shift 3
  curl -sS -L \
    --connect-timeout 5 \
    --max-time 20 \
    -o "${output}" \
    -w '%{http_code}' \
    -X "${method}" \
    "$@" \
    "${url}"
}

require_json_not_html() {
  local file="$1"
  if grep -F -q "PSA项目成本管理系统" "${file}"; then
    echo "Expected JSON response, got SPA HTML: $(body_preview "${file}")" >&2
    exit 1
  fi
  python3 - "$file" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    json.load(handle)
PY
}

echo "== NAS sync unauthorized checks =="
no_token_body="${TMP_DIR}/no-token.json"
no_token_status="$(request GET "${API_BASE}/events/pending?limit=1" "${no_token_body}")"
if [ "${no_token_status}" != "401" ]; then
  echo "Expected no-token request to return 401, got ${no_token_status}: $(body_preview "${no_token_body}")" >&2
  exit 1
fi
require_json_not_html "${no_token_body}"

bad_token_body="${TMP_DIR}/bad-token.json"
bad_token_status="$(request GET "${API_BASE}/events/pending?limit=1" "${bad_token_body}" -H "Authorization: Bearer __wrong_token__")"
if [ "${bad_token_status}" != "401" ]; then
  echo "Expected wrong-token request to return 401, got ${bad_token_status}: $(body_preview "${bad_token_body}")" >&2
  exit 1
fi
require_json_not_html "${bad_token_body}"

echo "== NAS sync pending and realtime-token checks =="
pending_body="${TMP_DIR}/pending.json"
pending_status="$(request GET "${API_BASE}/events/pending?limit=10" "${pending_body}" -H "Authorization: Bearer ${NAS_SYNC_TOKEN}")"
if [ "${pending_status}" != "200" ]; then
  echo "Expected pending request to return 200, got ${pending_status}: $(body_preview "${pending_body}")" >&2
  exit 1
fi
python3 - "$pending_body" <<'PY'
import json
import sys
allowed = {"eventId", "employeeId", "name", "type", "status", "attempts", "createdAt"}
forbidden = {"phone", "id_card", "salary", "monthly_salary", "daily_wage", "contract", "password", "token", "auth_email", "auth_user_id"}
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
assert data.get("ok") is True
events = data.get("events")
assert isinstance(events, list)
for event in events:
    keys = set(event)
    assert keys <= allowed, f"Unexpected pending event fields: {sorted(keys - allowed)}"
    assert not (keys & forbidden), f"Sensitive fields leaked: {sorted(keys & forbidden)}"
PY

realtime_body="${TMP_DIR}/realtime.json"
realtime_status="$(request GET "${API_BASE}/realtime-token" "${realtime_body}" -H "Authorization: Bearer ${NAS_SYNC_TOKEN}")"
if [ "${realtime_status}" != "200" ]; then
  echo "Expected realtime-token request to return 200, got ${realtime_status}: $(body_preview "${realtime_body}")" >&2
  exit 1
fi
python3 - "$realtime_body" "${NAS_SYNC_TOKEN}" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
assert set(data) == {"ok", "token", "expiresIn", "socketUrl", "channel", "event", "table"}
assert data["ok"] is True
assert data["token"] and data["token"] != sys.argv[2]
assert data["expiresIn"] > 0
assert data["socketUrl"].startswith(("ws://", "wss://"))
assert data["channel"] == "nas-sync"
assert data["event"] == "employee.created"
assert data["table"] == "public.nas_sync_events"
PY

if [ "${RUN_MUTATION_SMOKE}" != "1" ]; then
  echo "NAS sync safe HTTP smoke passed. Set NAS_SYNC_RUN_MUTATION_SMOKE=1 to run claim/complete/fail API checks with temporary rows."
  exit 0
fi

echo "== NAS sync mutation checks with temporary employees =="
command -v docker >/dev/null 2>&1 || {
  echo "Docker is required for mutation smoke setup." >&2
  exit 1
}

mapfile -t event_ids < <(
  docker exec -i "${POSTGRES_CONTAINER_NAME}" \
    psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -At <<'SQL'
DELETE FROM public.nas_sync_events WHERE employee_id IN (990010001, 990010002);
DELETE FROM public.employees WHERE id IN (990010001, 990010002);
INSERT INTO public.employees(id, employee_no, auth_user_id, name, is_active)
VALUES
  (990010001, 'NSYNCSMOKE001', gen_random_uuid(), 'NAS同步冒烟完成员工', true),
  (990010002, 'NSYNCSMOKE002', gen_random_uuid(), 'NAS同步冒烟失败员工', true);
SELECT id::text
FROM public.nas_sync_events
WHERE employee_id IN (990010001, 990010002)
ORDER BY employee_id;
SQL
)

complete_event_id="${event_ids[0]:-}"
fail_event_id="${event_ids[1]:-}"
if [ -z "${complete_event_id}" ] || [ -z "${fail_event_id}" ]; then
  echo "Failed to create temporary NAS sync events." >&2
  exit 1
fi

claim_body="${TMP_DIR}/claim-complete.json"
claim_status="$(request POST "${API_BASE}/events/${complete_event_id}/claim" "${claim_body}" -H "Authorization: Bearer ${NAS_SYNC_TOKEN}" -H "Content-Type: application/json" --data '{}')"
if [ "${claim_status}" != "200" ]; then
  echo "Expected first claim to return 200, got ${claim_status}: $(body_preview "${claim_body}")" >&2
  exit 1
fi
claim_token="$(python3 - "$claim_body" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    print(json.load(handle)["claimToken"])
PY
)"

second_claim_body="${TMP_DIR}/claim-conflict.json"
second_claim_status="$(request POST "${API_BASE}/events/${complete_event_id}/claim" "${second_claim_body}" -H "Authorization: Bearer ${NAS_SYNC_TOKEN}" -H "Content-Type: application/json" --data '{}')"
if [ "${second_claim_status}" != "409" ]; then
  echo "Expected second claim to return 409, got ${second_claim_status}: $(body_preview "${second_claim_body}")" >&2
  exit 1
fi

wrong_complete_body="${TMP_DIR}/wrong-complete.json"
wrong_complete_status="$(request POST "${API_BASE}/events/${complete_event_id}/complete" "${wrong_complete_body}" -H "Authorization: Bearer ${NAS_SYNC_TOKEN}" -H "Content-Type: application/json" --data '{"claimToken":"wrong","nasUsername":"smoke"}')"
if [ "${wrong_complete_status}" != "409" ]; then
  echo "Expected wrong complete claim to return 409, got ${wrong_complete_status}: $(body_preview "${wrong_complete_body}")" >&2
  exit 1
fi

complete_body="${TMP_DIR}/complete.json"
complete_status="$(request POST "${API_BASE}/events/${complete_event_id}/complete" "${complete_body}" -H "Authorization: Bearer ${NAS_SYNC_TOKEN}" -H "Content-Type: application/json" --data "{\"claimToken\":\"${claim_token}\",\"nasUsername\":\"NAS同步冒烟完成员工\"}")"
if [ "${complete_status}" != "200" ]; then
  echo "Expected complete to return 200, got ${complete_status}: $(body_preview "${complete_body}")" >&2
  exit 1
fi

fail_claim_body="${TMP_DIR}/claim-fail.json"
fail_claim_status="$(request POST "${API_BASE}/events/${fail_event_id}/claim" "${fail_claim_body}" -H "Authorization: Bearer ${NAS_SYNC_TOKEN}" -H "Content-Type: application/json" --data '{}')"
if [ "${fail_claim_status}" != "200" ]; then
  echo "Expected fail-path claim to return 200, got ${fail_claim_status}: $(body_preview "${fail_claim_body}")" >&2
  exit 1
fi
fail_claim_token="$(python3 - "$fail_claim_body" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as handle:
    print(json.load(handle)["claimToken"])
PY
)"

wrong_fail_body="${TMP_DIR}/wrong-fail.json"
wrong_fail_status="$(request POST "${API_BASE}/events/${fail_event_id}/fail" "${wrong_fail_body}" -H "Authorization: Bearer ${NAS_SYNC_TOKEN}" -H "Content-Type: application/json" --data '{"claimToken":"wrong","error":"wrong claim"}')"
if [ "${wrong_fail_status}" != "409" ]; then
  echo "Expected wrong fail claim to return 409, got ${wrong_fail_status}: $(body_preview "${wrong_fail_body}")" >&2
  exit 1
fi

fail_body="${TMP_DIR}/fail.json"
fail_status="$(request POST "${API_BASE}/events/${fail_event_id}/fail" "${fail_body}" -H "Authorization: Bearer ${NAS_SYNC_TOKEN}" -H "Content-Type: application/json" --data "{\"claimToken\":\"${fail_claim_token}\",\"error\":\"NAS smoke failure\"}")"
if [ "${fail_status}" != "200" ]; then
  echo "Expected fail to return 200, got ${fail_status}: $(body_preview "${fail_body}")" >&2
  exit 1
fi

echo "NAS sync full mutation smoke passed."
