-- V0.14.10: Normalize organization tree to actual two-department structure.

BEGIN;

DO $$
DECLARE
  v_pm bigint;
  v_cc bigint;
  v_pm_manage bigint;
  v_pm_design bigint;
  v_pm_cost bigint;
BEGIN
  SELECT id INTO v_pm FROM public.organizations WHERE org_code = 'PM' LIMIT 1;
  IF v_pm IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_pm FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_pm, 'PM', '项目管理', NULL, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = '项目管理', parent_id = NULL, org_type = 'department', status = 'active'
    WHERE id = v_pm;
  END IF;

  SELECT id INTO v_cc FROM public.organizations WHERE org_code = 'CC' LIMIT 1;
  IF v_cc IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_cc FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_cc, 'CC', '成本合约', NULL, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = '成本合约', parent_id = NULL, org_type = 'department', status = 'active'
    WHERE id = v_cc;
  END IF;

  SELECT id INTO v_pm_manage FROM public.organizations WHERE org_code = 'PM_MANAGE' LIMIT 1;
  IF v_pm_manage IS NULL THEN
    SELECT id INTO v_pm_manage FROM public.organizations WHERE org_code = 'PM_PROJECT' LIMIT 1;
    IF v_pm_manage IS NULL THEN
      SELECT COALESCE(MAX(id), 0) + 1 INTO v_pm_manage FROM public.organizations;
      INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
      VALUES (v_pm_manage, 'PM_MANAGE', '管理', v_pm, 'department', 'active');
    ELSE
      UPDATE public.organizations
      SET org_code = 'PM_MANAGE', org_name = '管理', parent_id = v_pm, org_type = 'department', status = 'active'
      WHERE id = v_pm_manage;
    END IF;
  ELSE
    UPDATE public.organizations
    SET org_name = '管理', parent_id = v_pm, org_type = 'department', status = 'active'
    WHERE id = v_pm_manage;
  END IF;

  SELECT id INTO v_pm_design FROM public.organizations WHERE org_code = 'PM_DESIGN' LIMIT 1;
  IF v_pm_design IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_pm_design FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_pm_design, 'PM_DESIGN', '设计', v_pm, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = '设计', parent_id = v_pm, org_type = 'department', status = 'active'
    WHERE id = v_pm_design;
  END IF;

  SELECT id INTO v_pm_cost FROM public.organizations WHERE org_code = 'PM_COST' LIMIT 1;
  IF v_pm_cost IS NULL THEN
    SELECT COALESCE(MAX(id), 0) + 1 INTO v_pm_cost FROM public.organizations;
    INSERT INTO public.organizations(id, org_code, org_name, parent_id, org_type, status)
    VALUES (v_pm_cost, 'PM_COST', '成本', v_pm, 'department', 'active');
  ELSE
    UPDATE public.organizations
    SET org_name = '成本', parent_id = v_pm, org_type = 'department', status = 'active'
    WHERE id = v_pm_cost;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS org_profile_targets(
    employee_id bigint PRIMARY KEY,
    target_org_id bigint NOT NULL,
    target_specialty text
  ) ON COMMIT DROP;
  TRUNCATE org_profile_targets;

  INSERT INTO org_profile_targets(employee_id, target_org_id, target_specialty)
  SELECT
    ep.employee_id,
    CASE
      WHEN o.org_code = 'COMP' OR o.org_name LIKE '%造价%' OR o.org_name LIKE '%成本合约%' THEN v_cc
      WHEN o.org_code = 'D009' OR o.org_name IN ('设计部', '设计审核') THEN v_pm_design
      WHEN o.org_code IN ('D002', 'D008') OR o.org_name IN ('项目管理部', '人事部') THEN v_pm_manage
      ELSE ep.org_id
    END,
    CASE
      WHEN o.org_code = 'COMP' OR o.org_name LIKE '%造价%' OR o.org_name LIKE '%成本合约%' THEN
        CASE
          WHEN e.employee_no IN ('QS000013', 'QS000022') THEN 'mep'
          WHEN e.employee_no LIKE 'QS%' THEN COALESCE(NULLIF(ep.cost_specialty, ''), 'civil')
          WHEN ep.cost_specialty IN ('civil', 'mep') THEN ep.cost_specialty
          WHEN ep.position_name LIKE '%机电%' THEN 'mep'
          WHEN ep.position_name LIKE '%土建%' THEN 'civil'
          ELSE ep.cost_specialty
        END
      ELSE NULL
    END
  FROM public.employee_profiles_v2 ep
  JOIN public.employees e ON e.id = ep.employee_id
  JOIN public.organizations o ON o.id = ep.org_id
  WHERE o.org_code IN ('COMP', 'D009', 'D002', 'D008')
     OR o.org_name LIKE '%造价%'
     OR o.org_name LIKE '%成本合约%'
     OR o.org_name IN ('设计部', '设计审核', '项目管理部', '人事部');

  -- Correct partially-applied earlier runs or legacy imports by employee code.
  INSERT INTO org_profile_targets(employee_id, target_org_id, target_specialty)
  SELECT ep.employee_id, v_pm_design, NULL
  FROM public.employee_profiles_v2 ep
  JOIN public.employees e ON e.id = ep.employee_id
  WHERE e.employee_no LIKE 'DES%'
     OR e.employee_no LIKE 'DS%'
  ON CONFLICT (employee_id) DO UPDATE
  SET target_org_id = EXCLUDED.target_org_id,
      target_specialty = EXCLUDED.target_specialty;

  INSERT INTO org_profile_targets(employee_id, target_org_id, target_specialty)
  SELECT ep.employee_id, v_pm_manage, NULL
  FROM public.employee_profiles_v2 ep
  JOIN public.employees e ON e.id = ep.employee_id
  WHERE e.employee_no = 'HR001'
     OR e.id = 20
  ON CONFLICT (employee_id) DO UPDATE
  SET target_org_id = EXCLUDED.target_org_id,
      target_specialty = EXCLUDED.target_specialty;

  INSERT INTO org_profile_targets(employee_id, target_org_id, target_specialty)
  SELECT
    ep.employee_id,
    v_cc,
    CASE
      WHEN ep.cost_specialty IN ('civil', 'mep') THEN ep.cost_specialty
      WHEN e.employee_no IN ('QS000013', 'QS000022') THEN 'mep'
      WHEN e.employee_no LIKE 'QS%' THEN 'civil'
      WHEN ep.position_name LIKE '%机电%' THEN 'mep'
      WHEN ep.position_name LIKE '%土建%' THEN 'civil'
      ELSE ep.cost_specialty
    END
  FROM public.employee_profiles_v2 ep
  JOIN public.employees e ON e.id = ep.employee_id
  WHERE e.employee_no LIKE 'QS%'
    AND e.id <> 20
  ON CONFLICT (employee_id) DO UPDATE
  SET target_org_id = EXCLUDED.target_org_id,
      target_specialty = EXCLUDED.target_specialty;

  UPDATE public.employee_profiles_v2 ep
  SET org_id = t.target_org_id,
      cost_specialty = t.target_specialty
  FROM org_profile_targets t
  WHERE ep.employee_id = t.employee_id;

  UPDATE public.organizations
  SET status = 'deleted'
  WHERE org_code IN ('COMPANY', 'COMP', 'D002', 'D008', 'D009', 'PM_PROJECT')
    AND id NOT IN (v_pm, v_cc, v_pm_manage, v_pm_design, v_pm_cost);
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
