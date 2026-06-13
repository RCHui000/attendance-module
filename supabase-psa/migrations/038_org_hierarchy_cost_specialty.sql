-- V0.14.8: Multi-level organization seed and cost specialty for future routing.

BEGIN;

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS cost_specialty text;

ALTER TABLE public.employee_profiles
  DROP CONSTRAINT IF EXISTS chk_employee_profiles_cost_specialty;
ALTER TABLE public.employee_profiles
  ADD CONSTRAINT chk_employee_profiles_cost_specialty
  CHECK (cost_specialty IS NULL OR cost_specialty IN ('civil', 'mep'));

COMMENT ON COLUMN public.employee_profiles.cost_specialty IS
  'Cost discipline for routing: civil=土建, mep=机电.';

DO $$
DECLARE
  v_company bigint;
  v_pm bigint;
  v_pm_project bigint;
  v_pm_design bigint;
  v_pm_cost bigint;
  v_cc bigint;
BEGIN
  SELECT id INTO v_company FROM public.organizations WHERE org_code = 'COMPANY' LIMIT 1;
  IF v_company IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_company FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_company, 'COMPANY', '公司', NULL, 'company', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = '公司', parent_id = NULL, org_type = 'company', status = 'active'
    WHERE id = v_company;
  END IF;

  SELECT id INTO v_pm FROM public.organizations WHERE org_code = 'PM' LIMIT 1;
  IF v_pm IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_pm FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_pm, 'PM', '项目管理', v_company, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = '项目管理', parent_id = v_company, org_type = 'department', status = 'active'
    WHERE id = v_pm;
  END IF;

  SELECT id INTO v_cc FROM public.organizations WHERE org_code = 'CC' LIMIT 1;
  IF v_cc IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_cc FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_cc, 'CC', '成本合约', v_company, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = '成本合约', parent_id = v_company, org_type = 'department', status = 'active'
    WHERE id = v_cc;
  END IF;

  SELECT id INTO v_pm_project FROM public.organizations WHERE org_code = 'PM_PROJECT' LIMIT 1;
  IF v_pm_project IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_pm_project FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_pm_project, 'PM_PROJECT', '项目管理', v_pm, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = '项目管理', parent_id = v_pm, org_type = 'department', status = 'active'
    WHERE id = v_pm_project;
  END IF;

  SELECT id INTO v_pm_design FROM public.organizations WHERE org_code = 'PM_DESIGN' LIMIT 1;
  IF v_pm_design IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_pm_design FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_pm_design, 'PM_DESIGN', '设计审核', v_pm, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = '设计审核', parent_id = v_pm, org_type = 'department', status = 'active'
    WHERE id = v_pm_design;
  END IF;

  SELECT id INTO v_pm_cost FROM public.organizations WHERE org_code = 'PM_COST' LIMIT 1;
  IF v_pm_cost IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_pm_cost FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_pm_cost, 'PM_COST', '成本部', v_pm, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = '成本部', parent_id = v_pm, org_type = 'department', status = 'active'
    WHERE id = v_pm_cost;
  END IF;
END $$;

CREATE OR REPLACE VIEW public.hr_employee_current_view
WITH (security_invoker = true)
AS
SELECT
    e.id                    AS employee_id,
    e.auth_user_id,
    e.employee_no,
    e.name                  AS employee_name,
    p.display_name,
    p.login_name,
    p.auth_email,
    ep.org_id,
    o.org_name,
    ep.position_name,
    ep.employment_status,
    ep.manager_user_id,
    ep.hire_date,
    ep.row_locked,
    ec.contract_type,
    ec.employment_type,
    ec.contract_start,
    ec.contract_end,
    esp.salary_mode,
    esp.monthly_salary,
    esp.daily_wage,
    esp.standard_monthly_workdays,
    e.is_active,
    ep.cost_specialty
FROM public.employees e
LEFT JOIN public.profiles p ON p.auth_user_id = e.auth_user_id
LEFT JOIN public.employee_profiles ep ON ep.employee_id = e.id
LEFT JOIN public.organizations o ON o.id = ep.org_id
LEFT JOIN public.employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = TRUE
LEFT JOIN public.employee_salary_profiles esp ON esp.employee_id = e.id AND esp.is_current = TRUE;

NOTIFY pgrst, 'reload schema';

COMMIT;
