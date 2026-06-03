-- V0.12.2: allow direct Realtime access from LAN/IP based hosts.
-- The self-hosted Realtime image seeds a "realtime-dev" tenant, while direct
-- socket requests derive the tenant from the first Host segment.

BEGIN;

DELETE FROM public.extensions
WHERE tenant_external_id IN ('192', 'localhost', '127');

DELETE FROM public.tenants
WHERE external_id IN ('192', 'localhost', '127');

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
  host_name,
  host_name,
  source.jwt_secret,
  source.max_concurrent_users,
  now(),
  now(),
  source.max_events_per_second,
  source.postgres_cdc_default,
  source.max_bytes_per_second,
  source.max_channels_per_client,
  source.max_joins_per_second,
  source.suspend,
  source.jwt_jwks,
  source.notify_private_alpha
FROM public.tenants AS source
CROSS JOIN (VALUES ('192'), ('localhost'), ('127')) AS hosts(host_name)
WHERE source.external_id = 'realtime-dev';

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
  source.type,
  source.settings,
  host_name,
  now(),
  now()
FROM public.extensions AS source
CROSS JOIN (VALUES ('192'), ('localhost'), ('127')) AS hosts(host_name)
WHERE source.tenant_external_id = 'realtime-dev';

COMMIT;
