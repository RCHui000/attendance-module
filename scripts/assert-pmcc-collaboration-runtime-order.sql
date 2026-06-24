DO $$
DECLARE
  v_template_order text[];
  v_expected_order text[] := ARRAY[
    'cc_project_owner',
    'cc_department_owner',
    'pm_cost_department_owner',
    'pm_project_owner',
    'pm_department_owner'
  ];
  v_bad_template_edges integer;
  v_old_runtime_edges integer;
BEGIN
  SELECT array_agg(tn.node_key ORDER BY tn.sort_order, tn.id)
    INTO v_template_order
  FROM public.approval_templates t
  JOIN public.approval_template_nodes tn ON tn.template_id = t.id
  WHERE t.template_key = 'contract_approval_pmcc_v1'
    AND tn.node_key = ANY(v_expected_order);

  IF v_template_order IS DISTINCT FROM v_expected_order THEN
    RAISE EXCEPTION 'PMCC template node order mismatch. expected %, got %',
      v_expected_order,
      v_template_order;
  END IF;

  WITH expected_edges(from_key, to_key) AS (
    VALUES
      ('cc_project_owner', 'cc_department_owner'),
      ('cc_department_owner', 'pm_cost_department_owner'),
      ('pm_cost_department_owner', 'pm_project_owner'),
      ('pm_project_owner', 'pm_department_owner')
  ),
  actual_edges AS (
    SELECT e.from_node_key AS from_key, e.to_node_key AS to_key
    FROM public.approval_templates t
    JOIN public.approval_template_edges e ON e.template_id = t.id
    WHERE t.template_key = 'contract_approval_pmcc_v1'
      AND e.from_node_key = ANY(v_expected_order)
      AND e.to_node_key = ANY(v_expected_order)
  )
  SELECT count(*) INTO v_bad_template_edges
  FROM (
    (SELECT * FROM expected_edges EXCEPT SELECT * FROM actual_edges)
    UNION ALL
    (SELECT * FROM actual_edges EXCEPT SELECT * FROM expected_edges)
  ) diff;

  IF v_bad_template_edges <> 0 THEN
    RAISE EXCEPTION 'PMCC template edge set is not the expected collaboration route';
  END IF;

  WITH running_pmcc_instances AS (
    SELECT DISTINCT i.id
    FROM public.approval_instances i
    JOIN public.approval_nodes n ON n.instance_id = i.id
    JOIN public.projects p ON p.id = n.scope_id AND n.scope_type = 'project'
    WHERE i.status = 'running'
      AND i.target_type = 'timesheet'
      AND p.business_type = 'PMCC'
  )
  SELECT count(*) INTO v_old_runtime_edges
  FROM running_pmcc_instances i
  JOIN public.approval_nodes from_node
    ON from_node.instance_id = i.id
   AND from_node.template_node_key = 'cc_project_owner'
  JOIN public.approval_edges e ON e.from_node_id = from_node.id
  JOIN public.approval_nodes to_node
    ON to_node.id = e.to_node_id
   AND to_node.instance_id = i.id
   AND to_node.template_node_key = 'pm_cost_department_owner';

  IF v_old_runtime_edges <> 0 THEN
    RAISE EXCEPTION 'Found % running PMCC runtime edges still using old cc_project_owner -> pm_cost_department_owner order',
      v_old_runtime_edges;
  END IF;
END $$;
