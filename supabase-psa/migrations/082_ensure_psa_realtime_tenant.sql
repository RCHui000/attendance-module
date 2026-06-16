-- Ensure the self-hosted Realtime tenant matches the running PSA realtime app.

BEGIN;

INSERT INTO public.tenants (
  id,
  name,
  external_id,
  jwt_secret,
  max_concurrent_users,
  inserted_at,
  updated_at,
  max_events_per_second,
  postgres_cdc_default,
  max_bytes_per_second,
  max_channels_per_client,
  max_joins_per_second,
  suspend,
  jwt_jwks,
  notify_private_alpha
)
SELECT
  gen_random_uuid(),
  'psa_realtime',
  'psa_realtime',
  jwt_secret,
  max_concurrent_users,
  now(),
  now(),
  max_events_per_second,
  postgres_cdc_default,
  max_bytes_per_second,
  max_channels_per_client,
  max_joins_per_second,
  suspend,
  jwt_jwks,
  notify_private_alpha
FROM public.tenants
WHERE external_id = 'realtime-dev'
  AND NOT EXISTS (
    SELECT 1 FROM public.tenants WHERE external_id = 'psa_realtime'
  );

UPDATE public.tenants target
SET
  jwt_secret = source.jwt_secret,
  postgres_cdc_default = source.postgres_cdc_default,
  updated_at = now()
FROM public.tenants source
WHERE target.external_id = 'psa_realtime'
  AND source.external_id = 'realtime-dev';

INSERT INTO public.extensions (
  id,
  type,
  settings,
  tenant_external_id,
  inserted_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  type,
  settings,
  'psa_realtime',
  now(),
  now()
FROM public.extensions source
WHERE source.tenant_external_id = 'realtime-dev'
  AND NOT EXISTS (
    SELECT 1
    FROM public.extensions existing
    WHERE existing.tenant_external_id = 'psa_realtime'
      AND existing.type = source.type
  );

UPDATE public.extensions target
SET
  settings = source.settings,
  updated_at = now()
FROM public.extensions source
WHERE target.tenant_external_id = 'psa_realtime'
  AND source.tenant_external_id = 'realtime-dev'
  AND target.type = source.type;

COMMIT;
