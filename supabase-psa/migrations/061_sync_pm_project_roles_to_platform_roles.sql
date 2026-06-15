-- V0.15: Keep platform roles aligned with PM project role assignments.

BEGIN;

DROP FUNCTION IF EXISTS public.psa_sync_project_platform_roles(BIGINT[]);

CREATE OR REPLACE FUNCTION public.psa_sync_project_platform_roles(p_employee_ids BIGINT[] DEFAULT NULL)
RETURNS TABLE(employee_id BIGINT, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.current_user_can_access_resource('report', 'write')
    OR public.current_user_can_access_resource('permission_config', 'write')
  ) THEN
    RAISE EXCEPTION 'permission denied'
      USING ERRCODE = '42501';
  END IF;

  IF p_employee_ids IS NOT NULL AND cardinality(p_employee_ids) = 0 THEN
    RETURN;
  END IF;

  WITH targets AS (
    SELECT DISTINCT e.id AS employee_id
    FROM public.employees e
    WHERE p_employee_ids IS NULL OR e.id = ANY(p_employee_ids)
  ),
  desired AS (
    SELECT
      t.employee_id,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.project_roles pr
          JOIN public.projects p ON p.id = pr.project_id
          WHERE pr.status = 'active'
            AND p.status <> 'deleted'
            AND pr.role_key = 'pm_department_owner'
            AND COALESCE(pr.user_id, pr.employee_id) = t.employee_id
        ) THEN 'manager'
        WHEN EXISTS (
          SELECT 1
          FROM public.project_roles pr
          JOIN public.projects p ON p.id = pr.project_id
          WHERE pr.status = 'active'
            AND p.status <> 'deleted'
            AND pr.role_key = 'pm_project_owner'
            AND COALESCE(pr.user_id, pr.employee_id) = t.employee_id
        ) THEN 'lead'
        ELSE 'employee'
      END AS desired_role
    FROM targets t
  ),
  preserved AS (
    SELECT DISTINCT ur.employee_id
    FROM public.user_roles ur
    JOIN desired d ON d.employee_id = ur.employee_id
    WHERE ur.role IN ('admin', 'director')
  ),
  changed AS (
    SELECT d.employee_id, d.desired_role
    FROM desired d
    WHERE NOT EXISTS (
      SELECT 1 FROM preserved p WHERE p.employee_id = d.employee_id
    )
  ),
  inserted AS (
    INSERT INTO public.user_roles(employee_id, role)
    SELECT c.employee_id, c.desired_role
    FROM changed c
    ON CONFLICT (employee_id, role) DO NOTHING
    RETURNING user_roles.employee_id, user_roles.role
  ),
  deleted AS (
    DELETE FROM public.user_roles ur
    USING changed c
    WHERE ur.employee_id = c.employee_id
      AND ur.role <> c.desired_role
    RETURNING ur.employee_id
  )
  SELECT c.employee_id, c.desired_role
  FROM changed c;
END;
$$;

ALTER FUNCTION public.psa_sync_project_platform_roles(BIGINT[]) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.psa_sync_project_platform_roles(BIGINT[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
