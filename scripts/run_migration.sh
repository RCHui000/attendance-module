#!/bin/bash
# V0.11: SQLite → Postgres data migration
# Run on NAS after Supabase is deployed
set -e
SCRIPT_DIR="$(dirname "$0")"
PROJECT_DIR="/vol1/@team/个人工作文件/惠若超/attendance-module"
SUPABASE_DIR="/vol1/@team/个人工作文件/惠若超/supabase-psa"

# Source secrets from Supabase .env
source "$SUPABASE_DIR/.env"

PG_URL="postgresql://psa_admin:${POSTGRES_PASSWORD}@192.168.2.100:5433/psa"
SQLITE_PATH="${PROJECT_DIR}/data/attendance_demo.sqlite3"

echo "=== V0.11 Data Migration ==="
echo "SQLite: $SQLITE_PATH"
echo "Postgres: 192.168.2.100:5433/psa"

# Run migration inside attendance container
docker exec attendance-module python /app/migrate_sqlite_to_supabase.py \
  --sqlite /data/attendance_demo.sqlite3 \
  --pg-url "$PG_URL" \
  --validate

echo "=== Migration Complete ==="
