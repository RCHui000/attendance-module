BEGIN;

-- pgcrypto extension installation can grant EXECUTE to PostgreSQL PUBLIC
-- on extension functions in the public schema. Keep the runtime grant posture
-- aligned with scripts/assert-function-grants.sql.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
