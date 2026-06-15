-- V0.15: Fix PM role sync name ambiguity and backfill existing assignments.

BEGIN;

DROP FUNCTION IF EXISTS public.psa_sync_project_platform_roles(BIGINT[]);

CREATE OR REPLACE FUNCTION public.psa_sync_project_platform_roles(p_employee_ids BIGINT[] DEFAULT NULL)
RETURNS TABLE(synced_employee_id BIGINT, synced_role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF session_user <> 'postgres' AND NOT (
    public.current_user_can_access_resource('report', 'write')
    OR public.current_user_can_access_resource('permission_config', 'write')
  ) THEN
    RAISE EXCEPTION 'permission denied'
      USING ERRCODE = '42501';
  END IF;

  IF p_employee_ids IS NOT NULL AND cardinality(p_employee_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH targets AS (
    SELECT DISTINCT e.id AS emp_id
    FROM public.employees e
    WHERE p_employee_ids IS NULL OR e.id = ANY(p_employee_ids)
  ),
  desired AS (
    SELECT
      t.emp_id,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.project_roles pr
          JOIN public.projects p ON p.id = pr.project_id
          WHERE pr.status = 'active'
            AND COALESCE(p.status, 'active') <> 'deleted'
            AND pr.role_key = 'pm_department_owner'
            AND COALESCE(pr.user_id, pr.employee_id) = t.emp_id
        ) THEN 'manager'
        WHEN EXISTS (
          SELECT 1
          FROM public.project_roles pr
          JOIN public.projects p ON p.id = pr.project_id
          WHERE pr.status = 'active'
            AND COALESCE(p.status, 'active') <> 'deleted'
            AND pr.role_key = 'pm_project_owner'
            AND COALESCE(pr.user_id, pr.employee_id) = t.emp_id
        ) THEN 'lead'
        ELSE 'employee'
      END AS desired_platform_role
    FROM targets t
  ),
  preserved AS (
    SELECT DISTINCT ur.employee_id AS emp_id
    FROM public.user_roles ur
    JOIN desired d ON d.emp_id = ur.employee_id
    WHERE ur.role IN ('admin', 'director')
  ),
  changed AS (
    SELECT d.emp_id, d.desired_platform_role
    FROM desired d
    WHERE NOT EXISTS (
      SELECT 1 FROM preserved p WHERE p.emp_id = d.emp_id
    )
  ),
  inserted AS (
    INSERT INTO public.user_roles(employee_id, role)
    SELECT c.emp_id, c.desired_platform_role
    FROM changed c
    ON CONFLICT ON CONSTRAINT user_roles_employee_id_role_key DO NOTHING
    RETURNING 1
  ),
  deleted AS (
    DELETE FROM public.user_roles ur
    USING changed c
    WHERE ur.employee_id = c.emp_id
      AND ur.role <> c.desired_platform_role
    RETURNING 1
  )
  SELECT c.emp_id, c.desired_platform_role
  FROM changed c;
END;
$$;

ALTER FUNCTION public.psa_sync_project_platform_roles(BIGINT[]) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.psa_sync_project_platform_roles(BIGINT[]) TO authenticated;

WITH backfill_targets AS (
  SELECT DISTINCT COALESCE(pr.user_id, pr.employee_id) AS emp_id
  FROM public.project_roles pr
  JOIN public.projects p ON p.id = pr.project_id
  WHERE pr.status = 'active'
    AND COALESCE(p.status, 'active') <> 'deleted'
    AND pr.role_key IN ('pm_project_owner', 'pm_department_owner')
    AND COALESCE(pr.user_id, pr.employee_id) IS NOT NULL
  UNION
  SELECT DISTINCT ur.employee_id AS emp_id
  FROM public.user_roles ur
  WHERE ur.role IN ('lead', 'manager')
),
desired AS (
  SELECT
    t.emp_id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.project_roles pr
        JOIN public.projects p ON p.id = pr.project_id
        WHERE pr.status = 'active'
          AND COALESCE(p.status, 'active') <> 'deleted'
          AND pr.role_key = 'pm_department_owner'
          AND COALESCE(pr.user_id, pr.employee_id) = t.emp_id
      ) THEN 'manager'
      WHEN EXISTS (
        SELECT 1
        FROM public.project_roles pr
        JOIN public.projects p ON p.id = pr.project_id
        WHERE pr.status = 'active'
          AND COALESCE(p.status, 'active') <> 'deleted'
          AND pr.role_key = 'pm_project_owner'
          AND COALESCE(pr.user_id, pr.employee_id) = t.emp_id
      ) THEN 'lead'
      ELSE 'employee'
    END AS desired_platform_role
  FROM backfill_targets t
),
preserved AS (
  SELECT DISTINCT ur.employee_id AS emp_id
  FROM public.user_roles ur
  JOIN desired d ON d.emp_id = ur.employee_id
  WHERE ur.role IN ('admin', 'director')
),
changed AS (
  SELECT d.emp_id, d.desired_platform_role
  FROM desired d
  WHERE NOT EXISTS (
    SELECT 1 FROM preserved p WHERE p.emp_id = d.emp_id
  )
),
inserted AS (
  INSERT INTO public.user_roles(employee_id, role)
  SELECT c.emp_id, c.desired_platform_role
  FROM changed c
  ON CONFLICT ON CONSTRAINT user_roles_employee_id_role_key DO NOTHING
  RETURNING 1
),
deleted AS (
  DELETE FROM public.user_roles ur
  USING changed c
  WHERE ur.employee_id = c.emp_id
    AND ur.role <> c.desired_platform_role
  RETURNING 1
)
SELECT COUNT(*) AS synced_pm_platform_roles
FROM changed;

NOTIFY pgrst, 'reload schema';

COMMIT;
