-- V0.15: repair employees that were created before profile-v2 writes succeeded.

BEGIN;

INSERT INTO public.employee_profiles_v2 (
  employee_id,
  org_id,
  position_name,
  cost_specialty,
  employment_status,
  manager_user_id,
  hire_date
)
SELECT
  e.id,
  NULL,
  '',
  NULL,
  CASE WHEN e.is_active THEN 'active' ELSE 'terminated' END,
  NULL,
  NULL
FROM public.employees e
WHERE NOT EXISTS (
  SELECT 1
  FROM public.employee_profiles_v2 ep
  WHERE ep.employee_id = e.id
);

NOTIFY pgrst, 'reload schema';

COMMIT;
