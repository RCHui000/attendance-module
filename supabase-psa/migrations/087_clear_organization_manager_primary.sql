-- V0.16.37: organization managers are peers; clear the legacy primary marker.
BEGIN;

UPDATE public.organization_managers
SET is_primary = FALSE,
    updated_at = NOW()
WHERE is_primary IS DISTINCT FROM FALSE;

NOTIFY pgrst, 'reload schema';

COMMIT;
