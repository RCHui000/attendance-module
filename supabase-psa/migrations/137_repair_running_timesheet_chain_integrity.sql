-- Repair legacy running-chain nodes after project-business applicability and
-- role routing rules changed. Historical assignee rows remain as audit data.

BEGIN;

DO $$
DECLARE
  v_round record;
BEGIN
  FOR v_round IN
    SELECT DISTINCT n.round_id
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    JOIN public.approval_templates tpl ON tpl.id = i.template_id
    JOIN public.timesheets t ON t.id = i.target_id
    JOIN public.projects p ON p.id = n.scope_id
    WHERE i.target_type = 'timesheet'
      AND i.status = 'running'
      AND t.status = 'submitted'
      AND tpl.template_key = 'contract_approval_pmcc_v1'
      AND n.status IN ('active', 'waiting', 'pending')
      AND NOT public.psa_pmcc_project_node_applicable(n.template_node_key, p.business_type)
  LOOP
    UPDATE public.approval_node_assignees a
    SET status = 'cancelled',
        action = 'cancelled',
        comment = 'V0.18.40 repair non-applicable running approval node',
        acted_at = now()
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    JOIN public.approval_templates tpl ON tpl.id = i.template_id
    JOIN public.projects p ON p.id = n.scope_id
    WHERE a.node_id = n.id
      AND n.round_id = v_round.round_id
      AND tpl.template_key = 'contract_approval_pmcc_v1'
      AND n.status IN ('active', 'waiting', 'pending')
      AND NOT public.psa_pmcc_project_node_applicable(n.template_node_key, p.business_type)
      AND a.status = 'pending';

    UPDATE public.approval_nodes n
    SET status = 'skipped',
        assignee_user_id = NULL,
        result_action = 'skipped',
        completed_at = COALESCE(n.completed_at, now()),
        comment = 'Not applicable for project business type',
        metadata = COALESCE(n.metadata, '{}'::jsonb)
          || jsonb_build_object('non_applicable_for_project_business_type', true),
        snapshot = COALESCE(n.snapshot, '{}'::jsonb)
          || jsonb_build_object('route_source', 'not_applicable_project_business_type'),
        updated_at = now()
    FROM public.approval_instances i
    JOIN public.approval_templates tpl ON tpl.id = i.template_id
    CROSS JOIN public.projects p
    WHERE n.instance_id = i.id
      AND p.id = n.scope_id
      AND n.round_id = v_round.round_id
      AND tpl.template_key = 'contract_approval_pmcc_v1'
      AND n.status IN ('active', 'waiting', 'pending')
      AND NOT public.psa_pmcc_project_node_applicable(n.template_node_key, p.business_type);

    PERFORM public.psa_activate_ready_nodes(v_round.round_id);
  END LOOP;
END;
$$;

-- If an active node still points at a removed role assignment and its template
-- policy allows missing assignees to skip, remove the stale pending candidate
-- and continue the serial graph. Waiting nodes are left untouched so project
-- roles can still be completed before their stage becomes active.
DO $$
DECLARE
  v_node record;
BEGIN
  LOOP
    SELECT n.id, n.round_id, n.assignee_user_id
      INTO v_node
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
      AND n.missing_assignee_policy = 'skip'
      AND resolved.assignee_user_id IS NULL
    ORDER BY n.id
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    UPDATE public.approval_node_assignees
    SET status = 'cancelled',
        action = 'cancelled',
        comment = 'V0.18.40 remove stale unresolved approval candidate',
        acted_at = now()
    WHERE node_id = v_node.id
      AND status = 'pending';

    UPDATE public.approval_nodes
    SET status = 'skipped',
        assignee_user_id = NULL,
        result_action = 'skipped',
        completed_at = now(),
        comment = 'No configured approver; stale route removed',
        snapshot = COALESCE(snapshot, '{}'::jsonb) || jsonb_build_object(
          'route_source', 'optional_unresolved_skipped',
          'previous_assignee_user_id', v_node.assignee_user_id,
          'route_repaired_at', now()
        ),
        updated_at = now()
    WHERE id = v_node.id;

    PERFORM public.psa_activate_ready_nodes(v_node.round_id);
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    JOIN public.approval_templates tpl ON tpl.id = i.template_id
    JOIN public.timesheets t ON t.id = i.target_id
    JOIN public.projects p ON p.id = n.scope_id
    WHERE i.target_type = 'timesheet'
      AND i.status = 'running'
      AND t.status = 'submitted'
      AND tpl.template_key = 'contract_approval_pmcc_v1'
      AND n.status IN ('active', 'waiting', 'pending')
      AND NOT public.psa_pmcc_project_node_applicable(n.template_node_key, p.business_type)
  ) THEN
    RAISE EXCEPTION 'Non-applicable PMCC runtime nodes remain actionable';
  END IF;
END;
$$;

COMMIT;
