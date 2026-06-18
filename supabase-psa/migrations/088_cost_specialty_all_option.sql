-- V0.16.39: support all-discipline cost/consulting specialty.
BEGIN;

ALTER TABLE public.employee_profiles
  DROP CONSTRAINT IF EXISTS chk_employee_profiles_cost_specialty;

ALTER TABLE public.employee_profiles
  ADD CONSTRAINT chk_employee_profiles_cost_specialty
  CHECK (cost_specialty IS NULL OR cost_specialty IN ('civil', 'mep', 'all'));

COMMENT ON COLUMN public.employee_profiles.cost_specialty IS
  'Cost/consulting discipline for routing: civil=土建, mep=机电, all=全专业.';

NOTIFY pgrst, 'reload schema';

COMMIT;
