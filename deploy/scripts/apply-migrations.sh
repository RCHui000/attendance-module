#!/usr/bin/env bash
set -euo pipefail

POSTGRES_CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-${1:-approval-postgres}}"
POSTGRES_USER="${POSTGRES_USER:-psa_admin}"
POSTGRES_DB="${POSTGRES_DB:-psa}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase-psa/migrations}"
MIGRATION_LEDGER_TABLE="${MIGRATION_LEDGER_TABLE:-public.psa_schema_migrations}"

if ! [[ "${MIGRATION_LEDGER_TABLE}" =~ ^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "MIGRATION_LEDGER_TABLE must be schema.table: ${MIGRATION_LEDGER_TABLE}" >&2
  exit 1
fi

if [ ! -d "${MIGRATIONS_DIR}" ]; then
  echo "Missing migrations directory: ${MIGRATIONS_DIR}" >&2
  exit 1
fi

duplicate_prefixes="$(
  for file in "${MIGRATIONS_DIR}"/*.sql; do
    basename "${file}"
  done | sed -n 's/^\([0-9][0-9][0-9]\)_.*/\1/p' | sort | uniq -d
)"

if [ -n "${duplicate_prefixes}" ]; then
  echo "Duplicate migration numeric prefixes found:" >&2
  echo "${duplicate_prefixes}" >&2
  exit 1
fi

psql_exec() {
  docker exec -i "${POSTGRES_CONTAINER_NAME}" \
    psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" "$@"
}

echo "== Ensure migration ledger =="
psql_exec <<SQL
CREATE TABLE IF NOT EXISTS ${MIGRATION_LEDGER_TABLE} (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

ledger_schema="${MIGRATION_LEDGER_TABLE%.*}"
ledger_name="${MIGRATION_LEDGER_TABLE#*.}"
ledger_type="$(psql_exec -Atc "SELECT data_type FROM information_schema.columns WHERE table_schema = '${ledger_schema}' AND table_name = '${ledger_name}' AND column_name = 'version' LIMIT 1")"

migration_key() {
  local version="$1"
  if [ "${ledger_type}" = "bigint" ] || [ "${ledger_type}" = "integer" ] || [ "${ledger_type}" = "numeric" ]; then
    echo "${version%%_*}" | sed 's/^0*//'
  else
    echo "${version}"
  fi
}

sql_literal() {
  local value="$1"
  if [ "${ledger_type}" = "bigint" ] || [ "${ledger_type}" = "integer" ] || [ "${ledger_type}" = "numeric" ]; then
    echo "${value}"
  else
    printf "'%s'" "${value//\'/\'\'}"
  fi
}

existing_schema="$(psql_exec -Atc "SELECT to_regclass('public.workflow_tasks') IS NOT NULL")"
ledger_count="$(psql_exec -Atc "SELECT count(*) FROM ${MIGRATION_LEDGER_TABLE}")"

if [ "${existing_schema}" = "t" ] && [ "${ledger_count}" = "0" ]; then
  echo "== Existing schema detected; marking baseline migrations =="
  for file in "${MIGRATIONS_DIR}"/*.sql; do
    version="$(basename "${file}" .sql)"
    case "${version}" in
      0[0-2][0-9]_*) ;;
      03[0-2]_*) ;;
      *) continue ;;
    esac
    key="$(migration_key "${version}")"
    psql_exec -c "INSERT INTO ${MIGRATION_LEDGER_TABLE}(version) VALUES ($(sql_literal "${key}")) ON CONFLICT (version) DO NOTHING;"
  done
fi

echo "== Apply pending migrations =="
for file in "${MIGRATIONS_DIR}"/*.sql; do
  version="$(basename "${file}" .sql)"
  key="$(migration_key "${version}")"
  applied="$(psql_exec -Atc "SELECT 1 FROM ${MIGRATION_LEDGER_TABLE} WHERE version = $(sql_literal "${key}")")"
  if [ "${applied}" = "1" ]; then
    echo "skip ${version}"
    continue
  fi

  echo "apply ${version}"
  psql_exec < "${file}"
  psql_exec -c "INSERT INTO ${MIGRATION_LEDGER_TABLE}(version) VALUES ($(sql_literal "${key}")) ON CONFLICT (version) DO NOTHING;"
done

echo "== Reload PostgREST schema cache =="
psql_exec -c "NOTIFY pgrst, 'reload schema';"
