-- V0.15: configurable platform RBAC. Approval Graph identities remain independent.

CREATE TABLE IF NOT EXISTS public.permission_roles (
  role_key TEXT PRIMARY KEY,
  role_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permission_resources (
  resource_key TEXT PRIMARY KEY,
  resource_name TEXT NOT NULL,
  resource_group TEXT NOT NULL DEFAULT 'sidebar',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_key TEXT NOT NULL REFERENCES public.permission_roles(role_key) ON DELETE CASCADE,
  resource_key TEXT NOT NULL REFERENCES public.permission_resources(resource_key) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'none',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_key, resource_key),
  CONSTRAINT role_permissions_access_level_chk CHECK (access_level IN ('none', 'read', 'write'))
);

INSERT INTO public.permission_roles(role_key, role_name, sort_order, is_system, is_active)
VALUES
  ('employee', '员工', 10, TRUE, TRUE),
  ('lead', '基层负责人', 20, TRUE, TRUE),
  ('manager', '主管', 30, TRUE, TRUE),
  ('director', '董事', 40, TRUE, TRUE),
  ('admin', '管理员', 50, TRUE, TRUE)
ON CONFLICT (role_key) DO UPDATE
SET role_name = EXCLUDED.role_name,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE,
    updated_at = NOW();

INSERT INTO public.permission_resources(resource_key, resource_name, resource_group, sort_order, is_active)
VALUES
  ('timesheet', '我的周表', 'sidebar', 10, TRUE),
  ('leave', '请假申请', 'sidebar', 20, TRUE),
  ('dashboard', '数据看板', 'sidebar', 30, TRUE),
  ('review', '审批中心', 'sidebar', 40, TRUE),
  ('report', '项目列表', 'sidebar', 50, TRUE),
  ('system_management', '系统管理', 'employee_org', 60, TRUE),
  ('permission_config', '权限配置', 'employee_org', 70, TRUE),
  ('apps', '应用中心', 'sidebar', 80, TRUE)
ON CONFLICT (resource_key) DO UPDATE
SET resource_name = EXCLUDED.resource_name,
    resource_group = EXCLUDED.resource_group,
    sort_order = EXCLUDED.sort_order,
    is_active = TRUE,
    updated_at = NOW();

WITH defaults(role_key, resource_key, access_level) AS (
  VALUES
    ('employee', 'timesheet', 'write'),
    ('employee', 'leave', 'write'),
    ('employee', 'apps', 'read'),
    ('lead', 'timesheet', 'write'),
    ('lead', 'leave', 'write'),
    ('lead', 'dashboard', 'read'),
    ('lead', 'review', 'write'),
    ('lead', 'report', 'read'),
    ('lead', 'apps', 'read'),
    ('manager', 'timesheet', 'write'),
    ('manager', 'leave', 'write'),
    ('manager', 'dashboard', 'read'),
    ('manager', 'review', 'write'),
    ('manager', 'report', 'write'),
    ('manager', 'system_management', 'write'),
    ('manager', 'apps', 'read'),
    ('director', 'timesheet', 'write'),
    ('director', 'leave', 'write'),
    ('director', 'dashboard', 'read'),
    ('director', 'review', 'write'),
    ('director', 'report', 'read'),
    ('director', 'system_management', 'read'),
    ('director', 'apps', 'read'),
    ('admin', 'timesheet', 'write'),
    ('admin', 'leave', 'write'),
    ('admin', 'dashboard', 'write'),
    ('admin', 'review', 'write'),
    ('admin', 'report', 'write'),
    ('admin', 'system_management', 'write'),
    ('admin', 'permission_config', 'write'),
    ('admin', 'apps', 'write')
)
INSERT INTO public.role_permissions(role_key, resource_key, access_level)
SELECT role_key, resource_key, access_level FROM defaults
ON CONFLICT (role_key, resource_key) DO NOTHING;

-- The old HR platform role is folded into the configurable manager role.
DELETE FROM public.user_roles hr
USING public.user_roles manager
WHERE hr.employee_id = manager.employee_id
  AND hr.role = 'hr'
  AND manager.role = 'manager';

UPDATE public.user_roles
SET role = 'manager'
WHERE role = 'hr';

DELETE FROM public.user_roles ur
USING public.user_roles keep
WHERE ur.employee_id = keep.employee_id
  AND ur.role = keep.role
  AND ur.ctid > keep.ctid;

CREATE OR REPLACE FUNCTION public.current_user_can_access_resource(
  p_resource_key TEXT,
  p_min_access TEXT DEFAULT 'read'
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH levels AS (
    SELECT 'none'::text AS access_level, 0 AS rank
    UNION ALL SELECT 'read', 1
    UNION ALL SELECT 'write', 2
  ),
  needed AS (
    SELECT rank FROM levels WHERE access_level = COALESCE(NULLIF(p_min_access, ''), 'read')
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.employees e ON e.id = ur.employee_id
    JOIN public.role_permissions rp ON rp.role_key = ur.role
    JOIN levels have ON have.access_level = rp.access_level
    CROSS JOIN needed
    WHERE e.auth_user_id = auth.uid()
      AND rp.resource_key = p_resource_key
      AND have.rank >= needed.rank
  );
$$;

ALTER FUNCTION public.current_user_can_access_resource(TEXT, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.current_user_can_access_resource(TEXT, TEXT) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.current_user_can_review()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_can_access_resource('review', 'write');
$$;

ALTER FUNCTION public.current_user_can_review() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.current_user_can_review() TO authenticated, anon;

DROP POLICY IF EXISTS "RBAC read employees" ON public.employees;
CREATE POLICY "RBAC read employees" ON public.employees
  FOR SELECT USING (public.current_user_can_access_resource('system_management', 'read'));

DROP POLICY IF EXISTS "RBAC write employees" ON public.employees;
CREATE POLICY "RBAC write employees" ON public.employees
  FOR ALL USING (public.current_user_can_access_resource('system_management', 'write'))
  WITH CHECK (public.current_user_can_access_resource('system_management', 'write'));

DROP POLICY IF EXISTS "RBAC read profiles v2" ON public.employee_profiles_v2;
CREATE POLICY "RBAC read profiles v2" ON public.employee_profiles_v2
  FOR SELECT USING (public.current_user_can_access_resource('system_management', 'read'));

DROP POLICY IF EXISTS "RBAC write profiles v2" ON public.employee_profiles_v2;
CREATE POLICY "RBAC write profiles v2" ON public.employee_profiles_v2
  FOR ALL USING (public.current_user_can_access_resource('system_management', 'write'))
  WITH CHECK (public.current_user_can_access_resource('system_management', 'write'));

DROP POLICY IF EXISTS "RBAC read contracts" ON public.employee_contracts;
CREATE POLICY "RBAC read contracts" ON public.employee_contracts
  FOR SELECT USING (public.current_user_can_access_resource('system_management', 'read'));

DROP POLICY IF EXISTS "RBAC write contracts" ON public.employee_contracts;
CREATE POLICY "RBAC write contracts" ON public.employee_contracts
  FOR ALL USING (public.current_user_can_access_resource('system_management', 'write'))
  WITH CHECK (public.current_user_can_access_resource('system_management', 'write'));

DROP POLICY IF EXISTS "RBAC read salary" ON public.employee_salary_profiles;
CREATE POLICY "RBAC read salary" ON public.employee_salary_profiles
  FOR SELECT USING (public.current_user_can_access_resource('system_management', 'read'));

DROP POLICY IF EXISTS "RBAC write salary" ON public.employee_salary_profiles;
CREATE POLICY "RBAC write salary" ON public.employee_salary_profiles
  FOR ALL USING (public.current_user_can_access_resource('system_management', 'write'))
  WITH CHECK (public.current_user_can_access_resource('system_management', 'write'));

DROP POLICY IF EXISTS "RBAC read organizations" ON public.organizations;
CREATE POLICY "RBAC read organizations" ON public.organizations
  FOR SELECT USING (public.current_user_can_access_resource('system_management', 'read'));

DROP POLICY IF EXISTS "RBAC write organizations" ON public.organizations;
CREATE POLICY "RBAC write organizations" ON public.organizations
  FOR ALL USING (public.current_user_can_access_resource('system_management', 'write'))
  WITH CHECK (public.current_user_can_access_resource('system_management', 'write'));

DROP POLICY IF EXISTS "RBAC read user roles" ON public.user_roles;
CREATE POLICY "RBAC read user roles" ON public.user_roles
  FOR SELECT USING (
    employee_id = public.current_employee_id()
    OR public.current_user_can_access_resource('system_management', 'read')
    OR public.current_user_can_access_resource('permission_config', 'read')
  );

DROP POLICY IF EXISTS "RBAC write user roles" ON public.user_roles;
CREATE POLICY "RBAC write user roles" ON public.user_roles
  FOR ALL USING (public.current_user_can_access_resource('permission_config', 'write'))
  WITH CHECK (public.current_user_can_access_resource('permission_config', 'write'));

ALTER TABLE public.permission_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read permission roles" ON public.permission_roles;
CREATE POLICY "Authenticated read permission roles" ON public.permission_roles
  FOR SELECT USING (auth.role() = 'authenticated' OR public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "Admin write permission roles" ON public.permission_roles;
DROP POLICY IF EXISTS "RBAC write permission roles" ON public.permission_roles;
CREATE POLICY "RBAC write permission roles" ON public.permission_roles
  FOR ALL USING (public.current_user_can_access_resource('permission_config', 'write'))
  WITH CHECK (public.current_user_can_access_resource('permission_config', 'write'));

DROP POLICY IF EXISTS "Authenticated read permission resources" ON public.permission_resources;
CREATE POLICY "Authenticated read permission resources" ON public.permission_resources
  FOR SELECT USING (auth.role() = 'authenticated' OR public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "Admin write permission resources" ON public.permission_resources;
DROP POLICY IF EXISTS "RBAC write permission resources" ON public.permission_resources;
CREATE POLICY "RBAC write permission resources" ON public.permission_resources
  FOR ALL USING (public.current_user_can_access_resource('permission_config', 'write'))
  WITH CHECK (public.current_user_can_access_resource('permission_config', 'write'));

DROP POLICY IF EXISTS "Authenticated read role permissions" ON public.role_permissions;
CREATE POLICY "Authenticated read role permissions" ON public.role_permissions
  FOR SELECT USING (auth.role() = 'authenticated' OR public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "Admin write role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "RBAC write role permissions" ON public.role_permissions;
CREATE POLICY "RBAC write role permissions" ON public.role_permissions
  FOR ALL USING (public.current_user_can_access_resource('permission_config', 'write'))
  WITH CHECK (public.current_user_can_access_resource('permission_config', 'write'));

GRANT SELECT ON public.permission_roles, public.permission_resources, public.role_permissions TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.permission_roles, public.permission_resources, public.role_permissions TO authenticated;
GRANT ALL ON public.permission_roles, public.permission_resources, public.role_permissions TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.psa_save_role_permission(
  p_role_key TEXT,
  p_resource_key TEXT,
  p_access_level TEXT
)
RETURNS TABLE(role_key TEXT, resource_key TEXT, access_level TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_can_access_resource('permission_config', 'write') THEN
    RAISE EXCEPTION 'Permission config write access is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_access_level NOT IN ('none', 'read', 'write') THEN
    RAISE EXCEPTION 'Invalid permission access level: %', p_access_level
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.permission_roles pr
    WHERE pr.role_key = p_role_key AND pr.is_active
  ) THEN
    RAISE EXCEPTION 'Unknown permission role: %', p_role_key
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.permission_resources res
    WHERE res.resource_key = p_resource_key AND res.is_active
  ) THEN
    RAISE EXCEPTION 'Unknown permission resource: %', p_resource_key
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.role_permissions(role_key, resource_key, access_level, updated_at)
  VALUES (p_role_key, p_resource_key, p_access_level, NOW())
  ON CONFLICT ON CONSTRAINT role_permissions_pkey DO UPDATE
  SET access_level = EXCLUDED.access_level,
      updated_at = NOW();

  RETURN QUERY
  SELECT rp.role_key, rp.resource_key, rp.access_level
  FROM public.role_permissions rp
  WHERE rp.role_key = p_role_key
    AND rp.resource_key = p_resource_key;
END;
$$;

ALTER FUNCTION public.psa_save_role_permission(TEXT, TEXT, TEXT) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.psa_save_role_permission(TEXT, TEXT, TEXT) TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
