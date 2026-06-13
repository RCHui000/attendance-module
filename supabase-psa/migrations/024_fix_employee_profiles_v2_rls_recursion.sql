-- Avoid recursive RLS evaluation on employee_profiles.
-- The older manager policy referenced employee_profiles from inside a
-- policy on employee_profiles, which can trigger "infinite recursion"
-- in PostgREST on a clean self-hosted deployment.
DROP POLICY IF EXISTS "Manager read org profiles" ON public.employee_profiles;

NOTIFY pgrst, 'reload schema';
