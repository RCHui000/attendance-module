-- V0.12.3: allow the server-side login resolver to map employee aliases
-- to GoTrue emails without relying on frontend hardcoded name maps.

GRANT SELECT ON public.profiles TO service_role;
GRANT SELECT ON public.employees TO service_role;
