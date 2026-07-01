-- Assert consulting-contract timesheet routing after CC -> CONSULTING migration.
--
-- Run against a migrated database:
--   docker exec -i approval-postgres psql -v ON_ERROR_STOP=1 -U psa_admin -d psa \
--     < scripts/assert-consulting-timesheet-routing.sql

DO $$
DECLARE
  v_cc_count int;
  v_business_type text;
  v_template_key text;
  v_project_id bigint;
  v_project_owner_name text;
  v_department_owner_name text;
  v_bad_pm_nodes int;
BEGIN
  SELECT count(*) INTO v_cc_count
  FROM (
    SELECT business_type FROM public.projects WHERE business_type = 'CC'
    UNION ALL
    SELECT business_type FROM public.project_role_requirements WHERE business_type = 'CC'
    UNION ALL
    SELECT business_type FROM public.approval_templates WHERE business_type = 'CC'
    UNION ALL
    SELECT business_type FROM public.approval_template_routing_rules WHERE business_type = 'CC'
    UNION ALL
    SELECT match_value FROM public.approval_business_type_source_rules WHERE match_value = 'CC'
    UNION ALL
    SELECT result_business_type FROM public.approval_business_type_source_rules WHERE result_business_type = 'CC'
    UNION ALL
    SELECT unnest(input_business_types) FROM public.approval_business_type_merge_rules WHERE 'CC' = ANY(input_business_types)
    UNION ALL
    SELECT result_business_type FROM public.approval_business_type_merge_rules WHERE result_business_type = 'CC'
    UNION ALL
    SELECT business_type FROM public.approval_role_aliases WHERE business_type = 'CC'
    UNION ALL
    SELECT input_business_type FROM public.approval_submitter_business_type_route_rules WHERE input_business_type = 'CC'
    UNION ALL
    SELECT result_business_type FROM public.approval_submitter_business_type_route_rules WHERE result_business_type = 'CC'
    UNION ALL
    SELECT business_type FROM public.business_documents WHERE business_type = 'CC'
  ) legacy;

  IF v_cc_count <> 0 THEN
    RAISE EXCEPTION 'Legacy CC business_type values remain: %', v_cc_count;
  END IF;

  SELECT public.psa_timesheet_business_type(t.id), tpl.template_key
    INTO v_business_type, v_template_key
  FROM public.timesheets t
  JOIN public.employees e ON e.id = t.user_id
  JOIN public.approval_instances i ON i.target_type = 'timesheet' AND i.target_id = t.id
  JOIN public.approval_templates tpl ON tpl.id = i.template_id
  WHERE e.name = '刘学霈'
    AND t.week_start_date = DATE '2026-06-22'
  ORDER BY i.created_at DESC
  LIMIT 1;

  IF v_business_type IS DISTINCT FROM 'PMCC' OR v_template_key IS DISTINCT FROM 'contract_approval_pmcc_v1' THEN
    RAISE EXCEPTION '刘学霈 2026-06-22 should route as PMCC with PMCC template, got business_type=%, template=%',
      v_business_type, v_template_key;
  END IF;

  SELECT id INTO v_project_id
  FROM public.projects
  WHERE code = 'P016'
     OR name LIKE '%沉淀池料斗分离仓%'
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'P016 project not found';
  END IF;

  WITH target AS (
    SELECT i.document_id
    FROM public.timesheets t
    JOIN public.employees e ON e.id = t.user_id
    JOIN public.approval_instances i ON i.target_type = 'timesheet' AND i.target_id = t.id
    WHERE e.name = '刘学霈'
      AND t.week_start_date = DATE '2026-06-22'
    ORDER BY i.created_at DESC
    LIMIT 1
  )
  SELECT owner.name
    INTO v_project_owner_name
  FROM target
  JOIN LATERAL public.psa_resolve_graph_assignees(
    target.document_id,
    'project_role',
    'cc_project_owner',
    v_project_id,
    false
  ) resolved ON TRUE
  LEFT JOIN public.employees owner ON owner.id = resolved.assignee_user_id
  LIMIT 1;

  IF v_project_owner_name IS DISTINCT FROM '王岳峰' THEN
    RAISE EXCEPTION 'P016 consulting project owner should resolve to 王岳峰, got %', v_project_owner_name;
  END IF;

  WITH target AS (
    SELECT i.document_id
    FROM public.timesheets t
    JOIN public.employees e ON e.id = t.user_id
    JOIN public.approval_instances i ON i.target_type = 'timesheet' AND i.target_id = t.id
    WHERE e.name = '刘学霈'
      AND t.week_start_date = DATE '2026-06-22'
    ORDER BY i.created_at DESC
    LIMIT 1
  )
  SELECT owner.name
    INTO v_department_owner_name
  FROM target
  JOIN LATERAL public.psa_resolve_graph_assignees(
    target.document_id,
    'org_manager',
    'department_owner',
    v_project_id,
    false
  ) resolved ON TRUE
  LEFT JOIN public.employees owner ON owner.id = resolved.assignee_user_id
  LIMIT 1;

  IF v_department_owner_name IS DISTINCT FROM '常雪松' THEN
    RAISE EXCEPTION 'P016 consulting department owner should resolve to 常雪松, got %', v_department_owner_name;
  END IF;

  SELECT count(*) INTO v_bad_pm_nodes
  FROM public.timesheets t
  JOIN public.employees e ON e.id = t.user_id
  JOIN public.approval_instances i ON i.target_type = 'timesheet' AND i.target_id = t.id
  JOIN public.approval_nodes n ON n.instance_id = i.id
  WHERE e.name = '刘学霈'
    AND t.week_start_date = DATE '2026-06-22'
    AND n.scope_type = 'project'
    AND n.scope_id = v_project_id
    AND n.status IN ('active', 'waiting', 'pending')
    AND n.resolver_role IN ('pm_project_owner', 'pm_department_owner');

  IF v_bad_pm_nodes <> 0 THEN
    RAISE EXCEPTION 'P016 should not have open PM-side nodes, found %', v_bad_pm_nodes;
  END IF;
END;
$$;
