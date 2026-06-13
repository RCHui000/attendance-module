-- V0.15: route timesheet project approvals by submitter department and specialty.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_resolve_timesheet_project_assignees(p_timesheet_id bigint)
RETURNS TABLE(project_id bigint, assignee_user_id bigint, assignee_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH sheet AS (
    SELECT
      t.id,
      t.user_id,
      ep.org_id,
      ep.cost_specialty,
      o.org_code,
      parent.org_code AS parent_org_code
    FROM public.timesheets t
    LEFT JOIN public.employee_profiles ep ON ep.employee_id = t.user_id
    LEFT JOIN public.organizations o ON o.id = ep.org_id
    LEFT JOIN public.organizations parent ON parent.id = o.parent_id
    WHERE t.id = p_timesheet_id
  ),
  project_scopes AS (
    SELECT DISTINCT te.project_id
    FROM public.timesheet_entries te
    WHERE te.timesheet_id = p_timesheet_id
      AND te.project_id IS NOT NULL
  ),
  desired_roles AS (
    SELECT
      ps.project_id,
      CASE
        WHEN s.org_code = 'CC' AND s.cost_specialty = 'mep' THEN ARRAY['cc_mep_project_owner', 'cc_project_owner', 'cc_department_owner']
        WHEN s.org_code = 'CC' THEN ARRAY['cc_civil_project_owner', 'cc_project_owner', 'cc_department_owner']
        WHEN s.org_code = 'PM_COST' THEN ARRAY['pm_cost_department_owner', 'pm_project_owner', 'pm_department_owner']
        WHEN s.org_code LIKE 'PM_%' OR s.parent_org_code = 'PM' OR s.org_code = 'PM' THEN ARRAY['pm_project_owner', 'pm_department_owner']
        ELSE ARRAY['project_owner', 'pm_project_owner', 'cc_project_owner']
      END AS role_keys
    FROM project_scopes ps
    CROSS JOIN sheet s
  ),
  role_matches AS (
    SELECT
      dr.project_id,
      pr.user_id AS assignee_user_id,
      pr.role_key AS assignee_role,
      array_position(dr.role_keys, pr.role_key) AS priority,
      pr.id
    FROM desired_roles dr
    JOIN public.project_roles pr ON pr.project_id = dr.project_id
     AND pr.role_key = ANY(dr.role_keys)
     AND pr.status = 'active'
     AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
     AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
  ),
  ranked_role_matches AS (
    SELECT DISTINCT ON (project_id)
      project_id,
      assignee_user_id,
      assignee_role
    FROM role_matches
    WHERE assignee_user_id IS NOT NULL
    ORDER BY project_id, priority, id DESC
  ),
  fallback_matches AS (
    SELECT
      ps.project_id,
      route.assignee_user_id,
      CASE
        WHEN route.route_source IN ('project_department_owner_exact', 'project_department_owner_parent', 'project_default_owner') THEN 'project_owner'
        WHEN route.route_source = 'submitter_org_manager' THEN 'department_head'
        ELSE 'admin'
      END AS assignee_role
    FROM project_scopes ps
    CROSS JOIN sheet s
    JOIN LATERAL public.psa_resolve_project_review_assignee(ps.project_id, s.user_id, s.org_id) route ON true
    WHERE NOT EXISTS (
      SELECT 1 FROM ranked_role_matches rm WHERE rm.project_id = ps.project_id
    )
  )
  SELECT project_id, assignee_user_id, assignee_role
  FROM ranked_role_matches
  UNION ALL
  SELECT project_id, assignee_user_id, assignee_role
  FROM fallback_matches
  WHERE assignee_user_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.psa_resolve_graph_assignees(
  p_document_id bigint,
  p_resolver_type text,
  p_resolver_role text,
  p_scope_id bigint DEFAULT NULL
)
RETURNS TABLE(assignee_user_id bigint, route_source text, matched_org_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH RECURSIVE doc AS (
    SELECT *
    FROM public.business_documents
    WHERE id = p_document_id
  ),
  org_chain AS (
    SELECT o.id, o.parent_id, 0 AS depth
    FROM public.organizations o
    JOIN doc d ON d.creator_org_id = o.id
    UNION ALL
    SELECT parent.id, parent.parent_id, child.depth + 1
    FROM public.organizations parent
    JOIN org_chain child ON child.parent_id = parent.id
  ),
  project_role_match AS (
    SELECT pr.user_id AS assignee_user_id, 'project_roles'::text AS route_source, pr.org_id AS matched_org_id, 1 AS priority
    FROM public.project_roles pr
    JOIN doc d ON d.project_id = pr.project_id OR pr.project_id = COALESCE(p_scope_id, d.project_id)
    WHERE p_resolver_type = 'project_role'
      AND pr.role_key = COALESCE(p_resolver_role, 'project_owner')
      AND pr.status = 'active'
      AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
      AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
    ORDER BY pr.org_id NULLS LAST, pr.id DESC
    LIMIT 1
  ),
  timesheet_project_owner AS (
    SELECT route.assignee_user_id, route.assignee_role AS route_source, NULL::bigint AS matched_org_id, 3 AS priority
    FROM doc d
    JOIN LATERAL public.psa_resolve_timesheet_project_assignees(d.business_id) route ON route.project_id = COALESCE(p_scope_id, d.project_id)
    WHERE p_resolver_type = 'project_role'
      AND d.document_type = 'timesheet'
      AND COALESCE(p_scope_id, d.project_id) IS NOT NULL
    LIMIT 1
  ),
  org_manager AS (
    SELECT o.manager_user_id AS assignee_user_id, 'org_manager'::text AS route_source, o.id AS matched_org_id, 4 + oc.depth AS priority
    FROM org_chain oc
    JOIN public.organizations o ON o.id = oc.id
    WHERE p_resolver_type = 'org_manager'
      AND NULLIF(o.manager_user_id, 0) IS NOT NULL
    ORDER BY oc.depth
    LIMIT 1
  ),
  creator AS (
    SELECT d.creator_user_id AS assignee_user_id, 'document_creator'::text AS route_source, d.creator_org_id AS matched_org_id, 20 AS priority
    FROM doc d
    WHERE p_resolver_type = 'document_creator'
  ),
  admin_fallback AS (
    SELECT ur.employee_id AS assignee_user_id, 'admin_fallback'::text AS route_source, NULL::bigint AS matched_org_id, 99 AS priority
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.employee_id
    LIMIT 1
  ),
  candidates AS (
    SELECT * FROM project_role_match
    UNION ALL SELECT * FROM timesheet_project_owner
    UNION ALL SELECT * FROM org_manager
    UNION ALL SELECT * FROM creator
    UNION ALL SELECT * FROM admin_fallback
  )
  SELECT assignee_user_id, route_source, matched_org_id
  FROM candidates
  WHERE assignee_user_id IS NOT NULL AND assignee_user_id <> 0
  ORDER BY priority
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.submit_document(
  p_document_type text,
  p_business_id bigint,
  p_business_version int DEFAULT 1,
  p_business_type text DEFAULT NULL,
  p_creator_user_id bigint DEFAULT NULL,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_request_id text DEFAULT NULL
)
RETURNS TABLE(document_id bigint, instance_id bigint, round_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_creator bigint := COALESCE(p_creator_user_id, public.current_employee_id());
  v_creator_org bigint;
  v_project_id bigint;
  v_template public.approval_templates%rowtype;
  v_snapshot jsonb;
  v_doc_id bigint;
  v_instance_id bigint;
  v_round_id bigint;
  v_node record;
  v_new_node_id bigint;
  v_from_id bigint;
  v_to_id bigint;
BEGIN
  SELECT ep.org_id INTO v_creator_org
  FROM public.employee_profiles ep
  WHERE ep.employee_id = v_creator
  LIMIT 1;

  IF p_document_type = 'timesheet' THEN
    SELECT te.project_id INTO v_project_id
    FROM public.timesheet_entries te
    WHERE te.timesheet_id = p_business_id
    ORDER BY te.project_id
    LIMIT 1;
  ELSE
    v_project_id := NULLIF((p_context ->> 'project_id')::bigint, 0);
  END IF;

  SELECT * INTO v_template
  FROM public.approval_templates
  WHERE document_type = p_document_type
    AND status = 'active'
    AND (business_type IS NULL OR business_type = p_business_type)
  ORDER BY CASE WHEN business_type = p_business_type THEN 0 ELSE 1 END, version DESC, id DESC
  LIMIT 1;

  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'No active approval template for document_type=% business_type=%', p_document_type, p_business_type;
  END IF;

  INSERT INTO public.business_documents (
    document_type, business_id, business_version, creator_user_id, creator_employee_id,
    creator_org_id, project_id, business_type, lifecycle_status, submitted_at
  )
  VALUES (
    p_document_type, p_business_id, p_business_version, v_creator, v_creator,
    v_creator_org, v_project_id, p_business_type, 'in_approval', now()
  )
  ON CONFLICT (document_type, business_id, business_version) DO UPDATE
  SET lifecycle_status = 'in_approval',
      submitted_at = COALESCE(public.business_documents.submitted_at, now()),
      updated_at = now()
  RETURNING id INTO v_doc_id;

  SELECT ai.id INTO v_instance_id
  FROM public.approval_instances ai
  WHERE ai.document_id = v_doc_id
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    SELECT ai.id INTO v_instance_id
    FROM public.approval_instances ai
    WHERE ai.target_type = p_document_type
      AND ai.target_id = p_business_id
    LIMIT 1;

    IF v_instance_id IS NOT NULL THEN
      UPDATE public.approval_instances ai
      SET document_id = v_doc_id,
          template_id = v_template.id,
          template_version = v_template.version,
          template_snapshot = public.psa_template_snapshot(v_template.id),
          status = 'running',
          updated_at = now()
      WHERE ai.id = v_instance_id;
    END IF;
  END IF;

  IF v_instance_id IS NOT NULL THEN
    SELECT ai.current_round_id INTO v_round_id
    FROM public.approval_instances ai
    WHERE ai.id = v_instance_id;
    submit_document.document_id := v_doc_id;
    submit_document.instance_id := v_instance_id;
    submit_document.round_id := v_round_id;
    RETURN NEXT;
    RETURN;
  END IF;

  v_snapshot := public.psa_template_snapshot(v_template.id);

  INSERT INTO public.approval_instances (
    approval_key, target_type, target_id, document_id, template_id, template_version,
    template_snapshot, status, current_round, created_by
  )
  VALUES (
    p_document_type, p_document_type, p_business_id, v_doc_id, v_template.id, v_template.version,
    v_snapshot, 'running', 1, v_creator
  )
  RETURNING id INTO v_instance_id;

  INSERT INTO public.approval_rounds (
    instance_id, round_no, round_type, status, started_by, created_by, reason
  )
  VALUES (v_instance_id, 1, 'initial_submit', 'running', v_creator, v_creator, 'submit_document')
  RETURNING id INTO v_round_id;

  UPDATE public.approval_instances ai
  SET current_round_id = v_round_id, current_round = 1, updated_at = now()
  WHERE ai.id = v_instance_id;

  FOR v_node IN
    SELECT *
    FROM public.approval_template_nodes
    WHERE template_id = v_template.id
    ORDER BY sort_order, node_key
  LOOP
    INSERT INTO public.approval_nodes (
      round_id, instance_id, node_key, template_node_key, node_name, node_type,
      scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
      reject_policy, snapshot, metadata
    )
    VALUES (
      v_round_id, v_instance_id, v_node.node_key, v_node.node_key, v_node.node_name, v_node.node_type,
      CASE WHEN p_document_type = 'timesheet' AND v_node.node_key = 'department_summary' THEN 'department_summary' ELSE p_document_type END,
      NULL,
      'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
      v_node.reject_policy, to_jsonb(v_node), to_jsonb(v_node)
    )
    RETURNING id INTO v_new_node_id;
  END LOOP;

  IF p_document_type = 'timesheet' THEN
    DELETE FROM public.approval_nodes n
    WHERE n.round_id = v_round_id AND n.node_key = 'project_review';

    FOR v_node IN
      SELECT project_id, assignee_user_id, assignee_role
      FROM public.psa_resolve_timesheet_project_assignees(p_business_id)
    LOOP
      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, assignee_user_id, assignee_role, snapshot, metadata
      )
      VALUES (
        v_round_id, v_instance_id, 'project_review_' || v_node.project_id, 'project_review',
        'Project Review', 'approval', 'project', v_node.project_id, 'waiting',
        'project_role', v_node.assignee_role, 'single', 'back_to_creator',
        v_node.assignee_user_id, v_node.assignee_role,
        jsonb_build_object('resolved_assignee_user_id', v_node.assignee_user_id, 'assignee_role', v_node.assignee_role),
        jsonb_build_object('project_id', v_node.project_id)
      );
    END LOOP;

    INSERT INTO public.approval_edges (round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type)
    SELECT v_round_id, v_instance_id, project_node.id, summary_node.id, 'normal', 'all_approved'
    FROM public.approval_nodes project_node
    JOIN public.approval_nodes summary_node
      ON summary_node.round_id = v_round_id AND summary_node.node_key = 'department_summary'
    WHERE project_node.round_id = v_round_id
      AND project_node.template_node_key = 'project_review';
  END IF;

  FOR v_node IN
    SELECT e.*
    FROM public.approval_template_edges e
    WHERE e.template_id = v_template.id
      AND NOT (p_document_type = 'timesheet' AND e.from_node_key = 'project_review')
  LOOP
    SELECT n.id INTO v_from_id FROM public.approval_nodes n WHERE n.round_id = v_round_id AND n.node_key = v_node.from_node_key LIMIT 1;
    SELECT n.id INTO v_to_id FROM public.approval_nodes n WHERE n.round_id = v_round_id AND n.node_key = v_node.to_node_key LIMIT 1;
    IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
      INSERT INTO public.approval_edges (round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type, condition_expr)
      VALUES (v_round_id, v_instance_id, v_from_id, v_to_id, v_node.edge_type, v_node.edge_type, v_node.condition_expr)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  PERFORM public.psa_activate_ready_nodes(v_round_id);
  PERFORM public.psa_write_approval_event(
    v_instance_id, v_round_id, NULL, NULL, v_creator, 'document_submitted',
    'draft', 'in_approval', p_request_id, '', p_context
  );

  submit_document.document_id := v_doc_id;
  submit_document.instance_id := v_instance_id;
  submit_document.round_id := v_round_id;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.psa_resolve_timesheet_project_assignees(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_resolve_graph_assignees(bigint, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_document(text, bigint, int, text, bigint, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
