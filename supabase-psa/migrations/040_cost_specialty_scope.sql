-- V0.14.11: Cost specialty applies to execution/project-owner employees only.

BEGIN;

UPDATE public.employee_profiles_v2 ep
SET cost_specialty = NULL
FROM public.employees e
LEFT JOIN public.user_roles ur ON ur.employee_id = e.id
WHERE ep.employee_id = e.id
  AND COALESCE(ur.role, 'employee') <> 'employee'
  AND ep.cost_specialty IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
