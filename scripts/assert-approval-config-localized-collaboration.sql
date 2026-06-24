-- Assert approval configuration is localized while keeping internal keys stable.

DO $$
DECLARE
  v_bad_count integer;
  v_pmcc_name text;
  v_department_resolver record;
BEGIN
  SELECT name INTO v_pmcc_name
  FROM public.approval_templates
  WHERE template_key = 'contract_approval_pmcc_v1';

  IF v_pmcc_name IS DISTINCT FROM '总工办/项目管理部协作审批' THEN
    RAISE EXCEPTION 'Expected localized PMCC collaboration template name, got %', COALESCE(v_pmcc_name, '<missing>');
  END IF;

  SELECT resolver_type, resolver_role
    INTO v_department_resolver
  FROM public.approval_template_nodes n
  JOIN public.approval_templates t ON t.id = n.template_id
  WHERE t.template_key = 'contract_approval_pmcc_v1'
    AND n.node_key = 'cc_department_owner';

  IF v_department_resolver.resolver_type IS DISTINCT FROM 'org_manager'
     OR v_department_resolver.resolver_role IS DISTINCT FROM 'department_owner' THEN
    RAISE EXCEPTION 'Collaboration source department owner must resolve from org_manager/department_owner, got %/%',
      COALESCE(v_department_resolver.resolver_type, '<missing>'),
      COALESCE(v_department_resolver.resolver_role, '<missing>');
  END IF;

  WITH expected(node_key, node_name, sort_order) AS (
    VALUES
      ('cc_submitter', '提交人', 10),
      ('cc_project_owner', '发起部门项目负责人', 20),
      ('cc_department_owner', '发起部门负责人', 30),
      ('pm_cost_department_owner', 'PM成本/设计负责人', 40),
      ('pm_project_owner', 'PM项目负责人', 50),
      ('pm_department_owner', 'PM部门负责人', 60)
  ),
  actual AS (
    SELECT n.node_key, n.node_name, n.sort_order
    FROM public.approval_template_nodes n
    JOIN public.approval_templates t ON t.id = n.template_id
    WHERE t.template_key = 'contract_approval_pmcc_v1'
  ),
  diff AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual WHERE node_key IN (SELECT node_key FROM expected) EXCEPT SELECT * FROM expected)
  )
  SELECT count(*) INTO v_bad_count
  FROM diff;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'Localized collaboration template nodes do not match expected business labels/order';
  END IF;

  WITH expected_edges(from_node_key, to_node_key) AS (
    VALUES
      ('cc_submitter', 'cc_project_owner'),
      ('cc_project_owner', 'cc_department_owner'),
      ('cc_department_owner', 'pm_cost_department_owner'),
      ('pm_cost_department_owner', 'pm_project_owner'),
      ('pm_project_owner', 'pm_department_owner')
  ),
  actual_edges AS (
    SELECT e.from_node_key, e.to_node_key
    FROM public.approval_template_edges e
    JOIN public.approval_templates t ON t.id = e.template_id
    WHERE t.template_key = 'contract_approval_pmcc_v1'
      AND e.edge_type = 'normal'
  ),
  edge_diff AS (
    (SELECT * FROM expected_edges EXCEPT SELECT * FROM actual_edges)
    UNION ALL
    (SELECT * FROM actual_edges EXCEPT SELECT * FROM expected_edges)
  )
  SELECT count(*) INTO v_bad_count
  FROM edge_diff;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'Collaboration template edges do not match source-side then PM-side route';
  END IF;
END $$;
