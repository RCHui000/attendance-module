#!/usr/bin/env bash
set -euo pipefail

TENDER_APP_URL="${TENDER_APP_URL:-https://xpjs.asia/apps/tender/}"
TENDER_APP_URL="${TENDER_APP_URL%/}/"
APP_ORIGIN="$(printf '%s' "${TENDER_APP_URL}" | sed -E 's#^(https?://[^/]+).*$#\1#')"
ROOT_BODY="$(mktemp)"
API_BODY="$(mktemp)"
trap 'rm -f "${ROOT_BODY}" "${API_BODY}"' EXIT

root_status="$(curl -sS --max-time 20 -o "${ROOT_BODY}" -w '%{http_code}' "${TENDER_APP_URL}")"
if [[ "${root_status}" != "200" ]]; then
  echo "Tender app root returned HTTP ${root_status}." >&2
  exit 1
fi

if grep -q '<title>PSA项目成本管理系统</title>' "${ROOT_BODY}"; then
  echo "Tender app route fell through to the PSA SPA." >&2
  exit 1
fi

asset_path="$(grep -oE 'src="/apps/tender/assets/[^"]+"' "${ROOT_BODY}" | head -n 1 | cut -d '"' -f 2)"
if [[ -z "${asset_path}" ]]; then
  echo "Tender app HTML does not reference its proxied frontend asset." >&2
  exit 1
fi

curl -fsS --max-time 20 -o /dev/null "${APP_ORIGIN}${asset_path}"

api_status="$(curl -sS --max-time 30 -o "${API_BODY}" -w '%{http_code}' "${TENDER_APP_URL}api/announcements?limit=1")"
if [[ "${api_status}" != "200" ]]; then
  echo "Tender app API returned HTTP ${api_status}." >&2
  exit 1
fi

if ! grep -q '"items"' "${API_BODY}" || ! grep -q '"total"' "${API_BODY}"; then
  echo "Tender app API response is not the expected announcement payload." >&2
  exit 1
fi

echo "Tender app HTTP smoke passed."
