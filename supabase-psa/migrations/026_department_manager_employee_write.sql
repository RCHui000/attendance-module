-- Allow department managers to maintain employee details for employees in
-- organizations they own. System role changes remain admin-only.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_manages_org(target_org_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH RECURSIVE actor AS (
    SELECT e.id
    FROM public.employees e
    WHERE e.auth_user_id = auth.uid()
    LIMIT 1
  ),
  admin_role AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN actor a ON a.id = ur.employee_id
      WHERE ur.role = 'admin'
    ) AS is_admin
  ),
  managed_orgs AS (
    SELECT o.id
    FROM public.organizations o
    JOIN actor a ON a.id = o.manager_user_id
    WHERE o.status = 'active'
    UNION ALL
    SELECT child.id
    FROM public.organizations child
    JOIN managed_orgs parent ON parent.id = child.parent_id
    WHERE child.status = 'active'
  )
  SELECT COALESCE((SELECT is_admin FROM admin_role), FALSE)
    OR EXISTS (
      SELECT 1
      FROM managed_orgs mo
      WHERE mo.id = target_org_id
    );
$$;

CREATE OR REPLACE FUNCTION public.current_user_can_manage_employee(target_employee_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.current_user_has_role('admin')
    OR EXISTS (
      SELECT 1
      FROM public.employee_profiles_v2 ep
      WHERE ep.employee_id = target_employee_id
        AND ep.org_id IS NOT NULL
        AND public.current_user_manages_org(ep.org_id)
    );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_manages_org(BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_manage_employee(BIGINT) TO authenticated, service_role;

DROP POLICY IF EXISTS "Department manager update employees" ON public.employees;
CREATE POLICY "Department manager update employees"
  ON public.employees
  FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_employee(id))
  WITH CHECK (public.current_user_can_manage_employee(id));

DROP POLICY IF EXISTS "Department manager update profiles v2" ON public.employee_profiles_v2;
CREATE POLICY "Department manager update profiles v2"
  ON public.employee_profiles_v2
  FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_employee(employee_id))
  WITH CHECK (
    public.current_user_has_role('admin')
    OR (org_id IS NOT NULL AND public.current_user_manages_org(org_id))
  );

DROP POLICY IF EXISTS "Department manager update contracts" ON public.employee_contracts;
CREATE POLICY "Department manager update contracts"
  ON public.employee_contracts
  FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_employee(employee_id))
  WITH CHECK (public.current_user_can_manage_employee(employee_id));

DROP POLICY IF EXISTS "Department manager insert contracts" ON public.employee_contracts;
CREATE POLICY "Department manager insert contracts"
  ON public.employee_contracts
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_manage_employee(employee_id));

DROP POLICY IF EXISTS "Department manager update salary" ON public.employee_salary_profiles;
CREATE POLICY "Department manager update salary"
  ON public.employee_salary_profiles
  FOR UPDATE TO authenticated
  USING (public.current_user_can_manage_employee(employee_id))
  WITH CHECK (public.current_user_can_manage_employee(employee_id));

DROP POLICY IF EXISTS "Department manager insert salary" ON public.employee_salary_profiles;
CREATE POLICY "Department manager insert salary"
  ON public.employee_salary_profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.current_user_can_manage_employee(employee_id));

NOTIFY pgrst, 'reload schema';

COMMIT;
