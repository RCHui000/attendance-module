DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  JOIN public.timesheets t ON t.id = i.target_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS pending_count
    FROM public.approval_node_assignees a
    WHERE a.node_id = n.id
      AND a.status = 'pending'
  ) pending ON true
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND n.status = 'active'
    AND pending.pending_count <> 1;

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'Active approval nodes without exactly one pending assignee: %', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.approval_node_assignees a
  JOIN public.approval_nodes n ON n.id = a.node_id
  JOIN public.approval_instances i ON i.id = n.instance_id
  JOIN public.timesheets t ON t.id = i.target_id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND a.status = 'pending'
    AND n.status <> 'active';

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'Pending assignees attached to non-active nodes: %', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.approval_edges edge
  JOIN public.approval_nodes previous ON previous.id = edge.from_node_id
  JOIN public.approval_nodes next ON next.id = edge.to_node_id
  JOIN public.approval_instances i ON i.id = next.instance_id
  JOIN public.timesheets t ON t.id = i.target_id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND COALESCE(edge.condition_result, true) = true
    AND previous.status NOT IN ('approved', 'skipped', 'cancelled')
    AND next.status IN ('active', 'approved');

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'Downstream nodes active before upstream completion: %', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  JOIN public.timesheets t ON t.id = i.target_id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND n.status = 'approved'
    AND COALESCE(n.approval_policy, 'single') <> 'auto_pass'
    AND NOT EXISTS (
      SELECT 1
      FROM public.approval_node_assignees a
      WHERE a.node_id = n.id
        AND a.status = 'approved'
        AND a.action IN ('approve', 'approved')
        AND a.acted_at IS NOT NULL
    );

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'Human approval nodes without a real approval action: %', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  JOIN public.approval_templates tpl ON tpl.id = i.template_id
  JOIN public.timesheets t ON t.id = i.target_id
  JOIN public.projects p ON p.id = n.scope_id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND tpl.template_key = 'contract_approval_pmcc_v1'
    AND NOT public.psa_pmcc_project_node_applicable(n.template_node_key, p.business_type)
    AND n.status NOT IN ('skipped', 'cancelled');

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'Non-applicable PMCC project nodes not skipped: %', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  JOIN public.timesheets t ON t.id = i.target_id
  LEFT JOIN LATERAL public.psa_resolve_graph_assignees(
    i.document_id,
    n.resolver_type,
    n.resolver_role,
    n.scope_id,
    false
  ) resolved ON true
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND n.status = 'active'
    AND n.node_type = 'approval'
    AND n.resolver_type <> 'document_creator'
    AND (
      resolved.assignee_user_id IS NULL
      OR n.assignee_user_id IS DISTINCT FROM resolved.assignee_user_id
    );

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'Active nodes do not match current route resolution: %', v_bad;
  END IF;
END;
$$;

SELECT 'PASS: running timesheet approval chains are internally consistent' AS result;
