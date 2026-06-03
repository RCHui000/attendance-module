-- V0.12.2: keep Supabase Realtime's Ecto migrations compatible with
-- existing PSA databases that already have a public.schema_migrations table.

ALTER TABLE IF EXISTS public.schema_migrations
  ADD COLUMN IF NOT EXISTS inserted_at timestamp(0) without time zone NOT NULL DEFAULT now();

ALTER TABLE IF EXISTS public.schema_migrations
  ALTER COLUMN version TYPE bigint USING version::bigint;
