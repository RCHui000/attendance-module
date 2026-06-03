-- V0.12.2: Supabase Realtime stores project CDC metadata in the realtime schema.

CREATE SCHEMA IF NOT EXISTS realtime AUTHORIZATION psa_admin;

GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA realtime TO psa_admin;
