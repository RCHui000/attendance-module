-- V0.15: generate serial timesheet Approval Graph chains by submitter department and project type.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_timesheet_project_approval_chain(p_timesheet_id bigint)
RETURNS TABLE(
  project_id bigint,
  step_order int,
  node_key text,
  node_name text,
  resolver_role text,
  assignee_user_id bigint,
  route_source text
)
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
    SELECT DISTINCT
      te.project_id,
      COALESCE(
        NULLIF(p.business_type, ''),
        CASE
          WHEN upper(p.code) LIKE 'PMCC%' THEN 'PMCC'
          WHEN upper(p.code) LIKE 'PM%' THEN 'PM'
          WHEN upper(p.code) LIKE 'CC%' THEN 'CC'
          ELSE NULL
        END
      ) AS business_type
    FROM public.timesheet_entries te
    JOIN public.projects p ON p.id = te.project_id
    WHERE te.timesheet_id = p_timesheet_id
      AND te.project_id IS NOT NULL
  ),
  desired_steps AS (
    SELECT
      ps.project_id,
      v.step_order,
      v.node_name,
      v.role_candidates
    FROM project_scopes ps
    CROSS JOIN sheet s
    CROSS JOIN LATERAL (
      VALUES
        (
          10,
          'CC Project Owner',
          CASE
            WHEN s.org_code = 'CC' AND s.cost_specialty = 'mep' AND ps.business_type IN ('CC', 'PMCC')
              THEN ARRAY['cc_mep_project_owner', 'cc_project_owner']
            WHEN s.org_code = 'CC' AND ps.business_type IN ('CC', 'PMCC')
              THEN ARRAY['cc_civil_project_owner', 'cc_project_owner']
            ELSE ARRAY[]::text[]
          END
        ),
        (
          20,
          'PM Cost Department Owner',
          CASE
            WHEN s.org_code = 'CC' AND ps.business_type = 'PMCC'
              THEN ARRAY['pm_cost_department_owner']
            WHEN s.org_code = 'PM_COST'
              THEN ARRAY['pm_cost_department_owner']
            ELSE ARRAY[]::text[]
          END
        ),
        (
          30,
          'PM Project Owner',
          CASE
            WHEN (s.org_code = 'CC' AND ps.business_type = 'PMCC')
              OR s.org_code LIKE 'PM_%'
              OR s.parent_org_code = 'PM'
              OR s.org_code = 'PM'
              THEN ARRAY['pm_project_owner']
            ELSE ARRAY[]::text[]
          END
        ),
        (
          40,
          'Department Owner',
          CASE
            WHEN s.org_code = 'CC' AND ps.business_type = 'CC'
              THEN ARRAY['cc_department_owner']
            WHEN (s.org_code = 'CC' AND ps.business_type = 'PMCC')
              OR s.org_code LIKE 'PM_%'
              OR s.parent_org_code = 'PM'
              OR s.org_code = 'PM'
              THEN ARRAY['pm_department_owner']
            ELSE ARRAY[]::text[]
          END
        )
    ) AS v(step_order, node_name, role_candidates)
    WHERE cardinality(v.role_candidates) > 0
  ),
  resolved_steps AS (
    SELECT
      ds.project_id,
      ds.step_order,
      ds.node_name,
      pr.role_key,
      pr.user_id AS assignee_user_id
    FROM desired_steps ds
    JOIN LATERAL (
      SELECT pr.*
      FROM public.project_roles pr
      WHERE pr.project_id = ds.project_id
        AND pr.role_key = ANY(ds.role_candidates)
        AND pr.status = 'active'
        AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
        AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
      ORDER BY array_position(ds.role_candidates, pr.role_key), pr.id DESC
      LIMIT 1
    ) pr ON true
  ),
  with_lag AS (
    SELECT
      rs.*,
      lag(rs.assignee_user_id) OVER (PARTITION BY rs.project_id ORDER BY rs.step_order) AS previous_assignee_user_id
    FROM resolved_steps rs
  ),
  grouped AS (
    SELECT
      wl.*,
      sum(CASE WHEN wl.previous_assignee_user_id = wl.assignee_user_id THEN 0 ELSE 1 END)
        OVER (PARTITION BY wl.project_id ORDER BY wl.step_order) AS same_assignee_group
    FROM with_lag wl
  ),
  compressed AS (
    SELECT DISTINCT ON (project_id, same_assignee_group)
      project_id,
      step_order,
      node_name,
      role_key,
      assignee_user_id
    FROM grouped
    ORDER BY project_id, same_assignee_group, step_order DESC
  )
  SELECT
    c.project_id,
    c.step_order,
    'project_' || c.project_id::text || '_' || c.step_order::text || '_' || c.role_key AS node_key,
    c.node_name,
    c.role_key AS resolver_role,
    c.assignee_user_id,
    'project_roles:' || c.role_key AS route_source
  FROM compressed c
  ORDER BY c.project_id, c.step_order;
$$;

CREATE OR REPLACE FUNCTION public.psa_activate_ready_nodes(p_round_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_node record;
  v_route record;
  v_assignee_user_id bigint;
  v_route_source text;
  v_matched_org_id bigint;
BEGIN
  FOR v_node IN
    SELECT n.*
    FROM public.approval_nodes n
    WHERE n.round_id = p_round_id
      AND n.status IN ('waiting', 'pending')
      AND NOT EXISTS (
        SELECT 1
        FROM public.approval_edges e
        JOIN public.approval_nodes from_node ON from_node.id = e.from_node_id
        WHERE e.round_id = p_round_id
          AND e.to_node_id = n.id
          AND e.condition_result = true
          AND from_node.status NOT IN ('approved', 'skipped')
      )
  LOOP
    UPDATE public.approval_nodes
    SET status = 'active',
        activated_at = COALESCE(activated_at, now()),
        updated_at = now()
    WHERE id = v_node.id
      AND status IN ('waiting', 'pending');

    IF v_node.approval_policy = 'auto_pass' THEN
      UPDATE public.approval_nodes
      SET status = 'approved',
          completed_at = now(),
          result_action = 'approve',
          updated_at = now()
      WHERE id = v_node.id;
    ELSE
      IF v_node.assignee_user_id IS NOT NULL THEN
        v_assignee_user_id := v_node.assignee_user_id;
        v_route_source := COALESCE(v_node.snapshot ->> 'route_source', v_node.resolver_role);
        v_matched_org_id := NULL;
      ELSE
        SELECT * INTO v_route
        FROM public.psa_resolve_graph_assignees(
          (SELECT ai.document_id FROM public.approval_instances ai WHERE ai.id = v_node.instance_id),
          v_node.resolver_type,
          v_node.resolver_role,
          v_node.scope_id
        )
        LIMIT 1;

        v_assignee_user_id := v_route.assignee_user_id;
        v_route_source := v_route.route_source;
        v_matched_org_id := v_route.matched_org_id;
      END IF;

      IF v_assignee_user_id IS NULL THEN
        IF COALESCE(v_node.metadata ->> 'optional', 'false') = 'true' THEN
          UPDATE public.approval_nodes
          SET status = 'skipped',
              result_action = 'skipped',
              completed_at = now(),
              updated_at = now()
          WHERE id = v_node.id;
          CONTINUE;
        END IF;
        RAISE EXCEPTION 'No assignee resolved for node %', v_node.node_key;
      END IF;

      INSERT INTO public.approval_node_assignees (
        node_id, assignee_user_id, assignee_employee_id, assignee_org_id, status
      )
      VALUES (
        v_node.id, v_assignee_user_id, v_assignee_user_id, v_matched_org_id, 'pending'
      )
      ON CONFLICT (node_id, assignee_user_id) DO NOTHING;

      UPDATE public.approval_nodes
      SET assignee_user_id = COALESCE(assignee_user_id, v_assignee_user_id),
          assignee_role = COALESCE(assignee_role, resolver_role),
          snapshot = snapshot || jsonb_build_object(
            'resolved_assignee_user_id', v_assignee_user_id,
            'route_source', v_route_source,
            'matched_org_id', v_matched_org_id
          ),
          updated_at = now()
      WHERE id = v_node.id;
    END IF;
  END LOOP;
END;
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
  v_previous_node_id bigint;
  v_from_id bigint;
  v_to_id bigint;
  v_project_id_for_skip bigint;
  v_terminal_unapproved int;
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

  IF p_document_type <> 'timesheet' THEN
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
        p_document_type, NULL,
        'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
        v_node.reject_policy, to_jsonb(v_node), to_jsonb(v_node)
      )
      RETURNING id INTO v_new_node_id;
    END LOOP;
  ELSE
    FOR v_node IN
      SELECT *
      FROM public.psa_timesheet_project_approval_chain(p_business_id)
      ORDER BY project_id, step_order
    LOOP
      IF v_previous_node_id IS NOT NULL AND v_project_id_for_skip IS DISTINCT FROM v_node.project_id THEN
        v_previous_node_id := NULL;
      END IF;

      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, assignee_user_id, assignee_role, snapshot, metadata
      )
      VALUES (
        v_round_id, v_instance_id, v_node.node_key, 'timesheet_serial_project_review',
        v_node.node_name, 'approval', 'project', v_node.project_id, 'waiting',
        'project_role', v_node.resolver_role, 'single', 'back_to_creator',
        v_node.assignee_user_id, v_node.resolver_role,
        jsonb_build_object(
          'resolved_assignee_user_id', v_node.assignee_user_id,
          'assignee_role', v_node.resolver_role,
          'route_source', v_node.route_source,
          'serial_step_order', v_node.step_order
        ),
        jsonb_build_object(
          'project_id', v_node.project_id,
          'optional', true,
          'serial_step_order', v_node.step_order,
          'compressed_serial_chain', true
        )
      )
      RETURNING id INTO v_new_node_id;

      IF v_previous_node_id IS NOT NULL THEN
        INSERT INTO public.approval_edges (round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type)
        VALUES (v_round_id, v_instance_id, v_previous_node_id, v_new_node_id, 'normal', 'all_approved')
        ON CONFLICT DO NOTHING;
      END IF;

      v_previous_node_id := v_new_node_id;
      v_project_id_for_skip := v_node.project_id;
    END LOOP;

    FOR v_project_id_for_skip IN
      SELECT DISTINCT te.project_id
      FROM public.timesheet_entries te
      WHERE te.timesheet_id = p_business_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.approval_nodes n
          WHERE n.round_id = v_round_id
            AND n.scope_type = 'project'
            AND n.scope_id = te.project_id
        )
    LOOP
      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, completed_at, result_action, comment, snapshot, metadata
      )
      VALUES (
        v_round_id, v_instance_id, 'project_' || v_project_id_for_skip::text || '_skipped_unresolved',
        'timesheet_serial_project_review', 'Project Review Skipped', 'approval',
        'project', v_project_id_for_skip, 'skipped', 'project_role', 'unresolved_optional',
        'single', 'back_to_creator', now(), 'skipped', 'No configured approver; optional node skipped',
        jsonb_build_object('route_source', 'optional_unresolved_skipped'),
        jsonb_build_object('project_id', v_project_id_for_skip, 'optional', true, 'unresolved_skipped', true)
      );
    END LOOP;
  END IF;

  IF p_document_type <> 'timesheet' THEN
    FOR v_node IN
      SELECT e.*
      FROM public.approval_template_edges e
      WHERE e.template_id = v_template.id
    LOOP
      SELECT n.id INTO v_from_id FROM public.approval_nodes n WHERE n.round_id = v_round_id AND n.node_key = v_node.from_node_key LIMIT 1;
      SELECT n.id INTO v_to_id FROM public.approval_nodes n WHERE n.round_id = v_round_id AND n.node_key = v_node.to_node_key LIMIT 1;
      IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
        INSERT INTO public.approval_edges (round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type, condition_expr)
        VALUES (v_round_id, v_instance_id, v_from_id, v_to_id, v_node.edge_type, v_node.edge_type, v_node.condition_expr)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  PERFORM public.psa_activate_ready_nodes(v_round_id);
  PERFORM public.psa_write_approval_event(
    v_instance_id, v_round_id, NULL, NULL, v_creator, 'document_submitted',
    'draft', 'in_approval', p_request_id, '', p_context
  );

  SELECT count(*) INTO v_terminal_unapproved
  FROM public.approval_nodes n
  WHERE n.round_id = v_round_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.approval_edges e
      WHERE e.round_id = v_round_id
        AND e.from_node_id = n.id
        AND e.condition_result = true
    )
    AND n.status NOT IN ('approved', 'skipped');

  IF v_terminal_unapproved = 0 THEN
    UPDATE public.approval_rounds
    SET status = 'approved', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_round_id AND status = 'running';

    UPDATE public.approval_instances
    SET status = 'approved', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_instance_id AND status = 'running';

    UPDATE public.business_documents
    SET lifecycle_status = 'approved', approved_at = COALESCE(approved_at, now()), updated_at = now()
    WHERE id = v_doc_id;

    IF p_document_type = 'timesheet' THEN
      UPDATE public.timesheets
      SET status = 'approved', approved_at = now(), updated_at = now()
      WHERE id = p_business_id;
    END IF;
  END IF;

  submit_document.document_id := v_doc_id;
  submit_document.instance_id := v_instance_id;
  submit_document.round_id := v_round_id;
  RETURN NEXT;
END;
$$;

DROP VIEW IF EXISTS public.approval_project_review_records_view;
CREATE VIEW public.approval_project_review_records_view AS
WITH project_nodes AS (
  SELECT
    COALESCE(i.target_id, d.business_id) AS timesheet_id,
    n.scope_id AS project_id,
    n.status,
    n.completed_at,
    n.activated_at,
    n.created_at,
    n.result_action,
    n.comment,
    n.assignee_role,
    n.resolver_role,
    n.snapshot
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  LEFT JOIN public.business_documents d ON d.id = i.document_id
  WHERE COALESCE(i.target_type, d.document_type) = 'timesheet'
    AND n.round_id = i.current_round_id
    AND n.scope_type = 'project'
    AND n.scope_id IS NOT NULL
    AND n.status <> 'cancelled'
)
SELECT
  timesheet_id,
  project_id,
  CASE
    WHEN bool_or(status = 'rejected') THEN 'needs_revision'
    WHEN bool_or(status IN ('active', 'waiting', 'pending', 'needs_reapproval')) THEN 'pending'
    WHEN bool_and(status IN ('approved', 'skipped')) THEN 'project_approved'
    ELSE 'pending'
  END AS status,
  string_agg(DISTINCT COALESCE(snapshot ->> 'route_source', assignee_role, resolver_role), ',' ORDER BY COALESCE(snapshot ->> 'route_source', assignee_role, resolver_role)) AS route_source,
  max(completed_at) FILTER (WHERE status IN ('approved', 'skipped')) AS project_approved_at,
  NULL::timestamptz AS final_confirmed_at,
  max(COALESCE(completed_at, activated_at, created_at)) AS last_action_at,
  CASE
    WHEN bool_or(status = 'rejected') THEN 'reject'
    WHEN bool_and(status IN ('approved', 'skipped')) THEN 'approve'
    ELSE NULL
  END AS result_action,
  (array_agg(comment ORDER BY COALESCE(completed_at, activated_at, created_at) DESC))[1] AS comment
FROM project_nodes
GROUP BY timesheet_id, project_id;

GRANT EXECUTE ON FUNCTION public.psa_timesheet_project_approval_chain(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_activate_ready_nodes(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_document(text, bigint, int, text, bigint, jsonb, text) TO authenticated;
GRANT SELECT ON public.approval_project_review_records_view TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
