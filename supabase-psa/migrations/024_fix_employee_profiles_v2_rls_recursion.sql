-- Avoid recursive RLS evaluation on employee_profiles_v2.
-- The older manager policy referenced employee_profiles_v2 from inside a
-- policy on employee_profiles_v2, which can trigger "infinite recursion"
-- in PostgREST on a clean self-hosted deployment.
DROP POLICY IF EXISTS "Manager read org profiles v2" ON public.employee_profiles_v2;

NOTIFY pgrst, 'reload schema';
