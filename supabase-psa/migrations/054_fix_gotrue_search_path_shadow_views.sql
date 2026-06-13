-- V0.15: remove public views that can shadow GoTrue auth tables when search_path is wrong.

DROP VIEW IF EXISTS public.mfa_amr_claims;
DROP VIEW IF EXISTS public.sessions;
DROP VIEW IF EXISTS public.refresh_tokens;
DROP VIEW IF EXISTS public.users;
DROP VIEW IF EXISTS public.mfa_factors;
DROP VIEW IF EXISTS public.mfa_challenges;
DROP VIEW IF EXISTS public.one_time_tokens;
DROP VIEW IF EXISTS public.saml_providers;
DROP VIEW IF EXISTS public.saml_relay_states;
DROP VIEW IF EXISTS public.sso_domains;
DROP VIEW IF EXISTS public.flow_state;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON public.profiles TO service_role;
GRANT SELECT ON public.employees TO service_role;
