BEGIN;

CREATE TABLE IF NOT EXISTS public.project_role_requirements (
  id bigserial PRIMARY KEY,
  business_type text NOT NULL CHECK (business_type IN ('PM', 'CC', 'PMCC')),
  role_key text NOT NULL,
  role_label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  fallback_role_key text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_type, role_key)
);

INSERT INTO public.project_role_requirements(
  business_type, role_key, role_label, sort_order, is_required, fallback_role_key, is_active
)
VALUES
  ('PM', 'pm_project_owner', 'PM项目负责人', 10, true, NULL, true),
  ('PM', 'pm_department_owner', 'PM部门负责人', 20, true, NULL, true),

  ('CC', 'cc_civil_project_owner', 'CC土建负责人', 10, true, 'cc_project_owner', true),
  ('CC', 'cc_mep_project_owner', 'CC机电负责人', 20, true, 'cc_project_owner', true),
  ('CC', 'cc_department_owner', 'CC部门负责人', 30, true, NULL, true),

  ('PMCC', 'cc_civil_project_owner', 'CC土建负责人', 10, true, 'cc_project_owner', true),
  ('PMCC', 'cc_mep_project_owner', 'CC机电负责人', 20, true, 'cc_project_owner', true),
  ('PMCC', 'pm_cost_department_owner', 'PM成本负责人', 30, true, NULL, true),
  ('PMCC', 'cc_department_owner', 'CC部门负责人', 40, true, NULL, true),
  ('PMCC', 'pm_project_owner', 'PM项目负责人', 50, true, NULL, true),
  ('PMCC', 'pm_department_owner', 'PM部门负责人', 60, true, NULL, true)
ON CONFLICT (business_type, role_key) DO UPDATE
SET role_label = EXCLUDED.role_label,
    sort_order = EXCLUDED.sort_order,
    is_required = EXCLUDED.is_required,
    fallback_role_key = EXCLUDED.fallback_role_key,
    is_active = EXCLUDED.is_active,
    updated_at = now();

ALTER TABLE public.project_role_requirements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read project role requirements" ON public.project_role_requirements;
CREATE POLICY "Authenticated read project role requirements"
  ON public.project_role_requirements
  FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Report writers manage project role requirements" ON public.project_role_requirements;
CREATE POLICY "Report writers manage project role requirements"
  ON public.project_role_requirements
  FOR ALL TO authenticated
  USING (public.current_user_can_access_resource('report', 'write'))
  WITH CHECK (public.current_user_can_access_resource('report', 'write'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_role_requirements TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.project_role_requirements_id_seq TO authenticated;
GRANT ALL ON public.project_role_requirements TO service_role;
GRANT ALL ON SEQUENCE public.project_role_requirements_id_seq TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
