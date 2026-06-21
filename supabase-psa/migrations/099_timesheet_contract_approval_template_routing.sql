-- V0.18: route timesheet approvals through the configured PM/CC/PMCC
-- contract_approval templates and expose approval chains by template node.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_timesheet_business_type(p_timesheet_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH project_types AS (
    SELECT DISTINCT
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
  )
  SELECT CASE
    WHEN bool_or(business_type = 'PMCC') THEN 'PMCC'
    WHEN bool_or(business_type = 'PM') AND bool_or(business_type = 'CC') THEN 'PMCC'
    WHEN bool_or(business_type = 'PM') THEN 'PM'
    WHEN bool_or(business_type = 'CC') THEN 'CC'
    ELSE NULL
  END
  FROM project_types;
$$;

REVOKE ALL ON FUNCTION public.psa_timesheet_business_type(bigint) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.psa_resolve_graph_assignees(
  p_document_id bigint,
  p_resolver_type text,
  p_resolver_role text,
  p_scope_id bigint DEFAULT NULL::bigint
)
RETURNS TABLE(assignee_user_id bigint, route_source text, matched_org_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH RECURSIVE doc AS (
    SELECT bd.*, ep.org_id, ep.cost_specialty, o.org_code, parent.org_code AS parent_org_code
    FROM public.business_documents bd
    LEFT JOIN public.employee_profiles ep ON ep.employee_id = bd.creator_user_id
    LEFT JOIN public.organizations o ON o.id = ep.org_id
    LEFT JOIN public.organizations parent ON parent.id = o.parent_id
    WHERE bd.id = p_document_id
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
  role_aliases AS (
    SELECT p_resolver_role AS role_key
    UNION ALL
    SELECT 'cc_mep_project_owner'
    WHERE p_resolver_role = 'cc_project_owner'
    UNION ALL
    SELECT 'cc_civil_project_owner'
    WHERE p_resolver_role = 'cc_project_owner'
  ),
  project_role_match AS (
    SELECT pr.user_id AS assignee_user_id, 'project_roles'::text AS route_source, pr.org_id AS matched_org_id, 1 AS priority
    FROM public.project_roles pr
    JOIN doc d ON d.project_id = pr.project_id OR pr.project_id = COALESCE(p_scope_id, d.project_id)
    WHERE p_resolver_type = 'project_role'
      AND pr.role_key IN (SELECT role_key FROM role_aliases WHERE role_key IS NOT NULL)
      AND pr.status = 'active'
      AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
      AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
    ORDER BY
      CASE WHEN pr.role_key = p_resolver_role THEN 0 ELSE 1 END,
      pr.org_id NULLS LAST,
      pr.id DESC
    LIMIT 1
  ),
  timesheet_project_owner AS (
    SELECT route.assignee_user_id, route.assignee_role AS route_source, NULL::bigint AS matched_org_id, 3 AS priority
    FROM doc d
    JOIN LATERAL public.psa_resolve_timesheet_project_assignees(d.business_id) route
      ON route.project_id = COALESCE(p_scope_id, d.project_id)
    WHERE p_resolver_type = 'project_role'
      AND d.document_type = 'timesheet'
      AND COALESCE(p_scope_id, d.project_id) IS NOT NULL
      AND route.assignee_role IN (SELECT role_key FROM role_aliases WHERE role_key IS NOT NULL)
    ORDER BY
      CASE WHEN route.assignee_role = p_resolver_role THEN 0 ELSE 1 END
    LIMIT 1
  ),
  org_manager AS (
    SELECT
      om.employee_id AS assignee_user_id,
      'org_manager'::text AS route_source,
      o.id AS matched_org_id,
      4 + oc.depth AS priority
    FROM org_chain oc
    JOIN public.organizations o ON o.id = oc.id
    JOIN public.organization_managers om ON om.org_id = o.id
    WHERE p_resolver_type = 'org_manager'
      AND om.is_active = TRUE
      AND om.manager_role = 'department_owner'
    ORDER BY oc.depth, om.is_primary DESC, om.updated_at DESC, om.id DESC
    LIMIT 1
  ),
  summary_department_role AS (
    SELECT pr.user_id AS assignee_user_id, pr.role_key AS route_source, pr.org_id AS matched_org_id, 10 AS priority
    FROM doc d
    JOIN public.project_roles pr ON pr.project_id = d.project_id
    WHERE p_resolver_type = 'org_manager'
      AND d.document_type = 'timesheet'
      AND pr.status = 'active'
      AND pr.role_key = CASE
        WHEN d.org_code = 'CC' THEN 'cc_department_owner'
        WHEN d.org_code LIKE 'PM_%' OR d.parent_org_code = 'PM' OR d.org_code = 'PM' THEN 'pm_department_owner'
        ELSE 'pm_department_owner'
      END
      AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
      AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
    ORDER BY pr.id DESC
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
    UNION ALL SELECT * FROM summary_department_role
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
  p_business_version integer DEFAULT 1,
  p_business_type text DEFAULT NULL::text,
  p_creator_user_id bigint DEFAULT NULL::bigint,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_request_id text DEFAULT NULL::text
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
  v_template_doc_type text;
  v_effective_business_type text := NULLIF(p_business_type, '');
  v_snapshot jsonb;
  v_doc_id bigint;
  v_instance_id bigint;
  v_round_id bigint;
  v_node record;
  v_project record;
  v_new_node_id bigint;
  v_previous_node_id bigint;
  v_from_id bigint;
  v_to_id bigint;
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

    v_effective_business_type := COALESCE(
      v_effective_business_type,
      public.psa_timesheet_business_type(p_business_id)
    );
    v_template_doc_type := 'contract_approval';
  ELSE
    v_project_id := NULLIF((p_context ->> 'project_id')::bigint, 0);
    v_template_doc_type := p_document_type;
  END IF;

  SELECT * INTO v_template
  FROM public.approval_templates
  WHERE status = 'active'
    AND (
      (
        document_type = v_template_doc_type
        AND (business_type IS NULL OR business_type = v_effective_business_type)
      )
      OR (
        p_document_type = 'timesheet'
        AND document_type = 'timesheet'
        AND business_type IS NULL
      )
    )
  ORDER BY
    CASE
      WHEN document_type = v_template_doc_type AND business_type = v_effective_business_type THEN 0
      WHEN document_type = v_template_doc_type AND business_type IS NULL THEN 1
      WHEN document_type = p_document_type THEN 2
      ELSE 3
    END,
    version DESC,
    id DESC
  LIMIT 1;

  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'No active approval template for document_type=% business_type=%', p_document_type, v_effective_business_type;
  END IF;

  INSERT INTO public.business_documents (
    document_type, business_id, business_version, creator_user_id, creator_employee_id,
    creator_org_id, project_id, business_type, lifecycle_status, submitted_at
  )
  VALUES (
    p_document_type, p_business_id, p_business_version, v_creator, v_creator,
    v_creator_org, v_project_id, v_effective_business_type, 'in_approval', now()
  )
  ON CONFLICT (document_type, business_id, business_version) DO UPDATE
  SET lifecycle_status = 'in_approval',
      business_type = EXCLUDED.business_type,
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
    FOR v_project IN
      SELECT DISTINCT te.project_id
      FROM public.timesheet_entries te
      WHERE te.timesheet_id = p_business_id
        AND te.project_id IS NOT NULL
      ORDER BY te.project_id
    LOOP
      v_previous_node_id := NULL;

      FOR v_node IN
        SELECT *
        FROM public.approval_template_nodes
        WHERE template_id = v_template.id
          AND node_type = 'approval'
          AND resolver_type <> 'document_creator'
          AND COALESCE(resolver_role, '') <> 'submitter'
        ORDER BY sort_order, node_key
      LOOP
        INSERT INTO public.approval_nodes (
          round_id, instance_id, node_key, template_node_key, node_name, node_type,
          scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
          reject_policy, snapshot, metadata
        )
        VALUES (
          v_round_id, v_instance_id,
          'project_' || v_project.project_id::text || '_' || v_node.node_key,
          v_node.node_key,
          v_node.node_name,
          v_node.node_type,
          'project',
          v_project.project_id,
          'waiting',
          v_node.resolver_type,
          v_node.resolver_role,
          v_node.approval_policy,
          v_node.reject_policy,
          to_jsonb(v_node),
          to_jsonb(v_node) || jsonb_build_object(
            'project_id', v_project.project_id,
            'optional', true,
            'template_driven_timesheet', true
          )
        )
        RETURNING id INTO v_new_node_id;

        IF v_previous_node_id IS NOT NULL THEN
          INSERT INTO public.approval_edges (round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type)
          VALUES (v_round_id, v_instance_id, v_previous_node_id, v_new_node_id, 'normal', 'all_approved')
          ON CONFLICT DO NOTHING;
        END IF;

        v_previous_node_id := v_new_node_id;
      END LOOP;
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

WITH typed_instances AS (
  SELECT
    i.id AS instance_id,
    i.document_id,
    i.target_id AS timesheet_id,
    public.psa_timesheet_business_type(i.target_id) AS business_type
  FROM public.approval_instances i
  JOIN public.timesheets t ON t.id = i.target_id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
),
selected_templates AS (
  SELECT DISTINCT ON (ti.instance_id)
    ti.instance_id,
    ti.document_id,
    ti.business_type,
    tpl.id AS template_id,
    tpl.version AS template_version
  FROM typed_instances ti
  JOIN public.approval_templates tpl
    ON tpl.document_type = 'contract_approval'
   AND tpl.business_type = ti.business_type
   AND tpl.status = 'active'
  ORDER BY ti.instance_id, tpl.version DESC, tpl.id DESC
)
UPDATE public.approval_instances i
SET template_id = st.template_id,
    template_version = st.template_version,
    template_snapshot = public.psa_template_snapshot(st.template_id),
    updated_at = now()
FROM selected_templates st
WHERE i.id = st.instance_id;

WITH typed_instances AS (
  SELECT
    i.id AS instance_id,
    i.document_id,
    public.psa_timesheet_business_type(i.target_id) AS business_type
  FROM public.approval_instances i
  JOIN public.timesheets t ON t.id = i.target_id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
)
UPDATE public.business_documents bd
SET business_type = ti.business_type,
    updated_at = now()
FROM typed_instances ti
WHERE bd.id = ti.document_id
  AND ti.business_type IS NOT NULL;

WITH node_roles AS (
  SELECT
    n.id AS node_id,
    i.template_id,
    public.psa_timesheet_business_type(i.target_id) AS business_type,
    CASE
      WHEN COALESCE(n.resolver_role, n.assignee_role) IN ('cc_project_owner', 'cc_mep_project_owner', 'cc_civil_project_owner') THEN 'cc_project_owner'
      WHEN COALESCE(n.resolver_role, n.assignee_role) = 'project_owner' AND public.psa_timesheet_business_type(i.target_id) = 'CC' THEN 'cc_project_owner'
      WHEN COALESCE(n.resolver_role, n.assignee_role) = 'project_owner' AND public.psa_timesheet_business_type(i.target_id) IN ('PM', 'PMCC') THEN 'pm_project_owner'
      WHEN COALESCE(n.resolver_role, n.assignee_role) = 'department_head' AND public.psa_timesheet_business_type(i.target_id) = 'CC' THEN 'cc_department_owner'
      WHEN COALESCE(n.resolver_role, n.assignee_role) = 'department_head' AND public.psa_timesheet_business_type(i.target_id) IN ('PM', 'PMCC') THEN 'pm_department_owner'
      ELSE COALESCE(n.resolver_role, n.assignee_role)
    END AS mapped_role
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  JOIN public.timesheets t ON t.id = i.target_id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND n.status <> 'cancelled'
),
node_templates AS (
  SELECT DISTINCT ON (nr.node_id)
    nr.node_id,
    tn.node_key,
    tn.node_name,
    tn.resolver_role
  FROM node_roles nr
  JOIN public.approval_template_nodes tn
    ON tn.template_id = nr.template_id
   AND tn.resolver_role = nr.mapped_role
  ORDER BY nr.node_id, tn.sort_order, tn.id
)
UPDATE public.approval_nodes n
SET template_node_key = nt.node_key,
    node_name = nt.node_name,
    resolver_role = nt.resolver_role,
    updated_at = now()
FROM node_templates nt
WHERE n.id = nt.node_id;

WITH skipped_unmapped AS (
  SELECT
    n.id AS node_id,
    i.template_id
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  JOIN public.timesheets t ON t.id = i.target_id
  LEFT JOIN public.approval_template_nodes existing_tn
    ON existing_tn.template_id = i.template_id
   AND existing_tn.node_key = n.template_node_key
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND n.status = 'skipped'
    AND n.resolver_role = 'unresolved_optional'
    AND existing_tn.id IS NULL
),
first_project_template_node AS (
  SELECT DISTINCT ON (su.node_id)
    su.node_id,
    tn.node_key,
    tn.node_name,
    tn.resolver_role
  FROM skipped_unmapped su
  JOIN public.approval_template_nodes tn
    ON tn.template_id = su.template_id
   AND tn.node_type = 'approval'
   AND tn.resolver_type <> 'document_creator'
  ORDER BY su.node_id, tn.sort_order, tn.id
)
UPDATE public.approval_nodes n
SET template_node_key = fptn.node_key,
    node_name = fptn.node_name,
    resolver_role = fptn.resolver_role,
    updated_at = now()
FROM first_project_template_node fptn
WHERE n.id = fptn.node_id;

CREATE OR REPLACE FUNCTION public.psa_timesheet_approval_chain(p_timesheet_id bigint)
RETURNS TABLE (
  node_id bigint,
  node_key text,
  node_name text,
  scope_type text,
  scope_id bigint,
  node_status text,
  assignee_role text,
  resolver_role text,
  approval_policy text,
  sort_order integer,
  activated_at timestamptz,
  completed_at timestamptz,
  result_action text,
  comment text,
  can_current_user_act boolean,
  assignees jsonb,
  blocking_nodes jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH instance_row AS (
    SELECT i.*
    FROM public.approval_instances i
    WHERE COALESCE(i.target_type, '') = 'timesheet'
      AND i.target_id = p_timesheet_id
    ORDER BY CASE WHEN i.status = 'running' THEN 0 ELSE 1 END, i.id DESC
    LIMIT 1
  ),
  template_nodes AS (
    SELECT tn.*
    FROM instance_row i
    JOIN public.approval_template_nodes tn ON tn.template_id = i.template_id
    WHERE tn.node_type = 'approval'
      AND tn.resolver_type <> 'document_creator'
      AND COALESCE(tn.resolver_role, '') <> 'submitter'
  ),
  runtime_nodes AS (
    SELECT n.*, p.code AS project_code, p.name AS project_name
    FROM instance_row i
    JOIN public.approval_nodes n ON n.instance_id = i.id
    LEFT JOIN public.projects p ON p.id = n.scope_id AND n.scope_type = 'project'
  ),
  runtime_assignees AS (
    SELECT
      rn.template_node_key,
      jsonb_agg(
        jsonb_build_object(
          'node_id', rn.id,
          'node_name', rn.node_name,
          'node_status', rn.status,
          'project_id', CASE WHEN rn.scope_type = 'project' THEN rn.scope_id ELSE NULL END,
          'project_code', COALESCE(rn.project_code, ''),
          'project_name', COALESCE(rn.project_name, ''),
          'assignee_user_id', COALESCE(a.assignee_user_id, rn.assignee_user_id, 0),
          'assignee_name', e.name,
          'status', COALESCE(a.status, rn.status),
          'action', COALESCE(a.action, rn.result_action),
          'comment', COALESCE(a.comment, rn.comment),
          'acted_at', a.acted_at
        )
        ORDER BY rn.id, a.id NULLS LAST
      ) FILTER (WHERE rn.id IS NOT NULL) AS assignees
    FROM runtime_nodes rn
    LEFT JOIN public.approval_node_assignees a ON a.node_id = rn.id
    LEFT JOIN public.employees e ON e.id = COALESCE(a.assignee_user_id, rn.assignee_user_id)
    GROUP BY rn.template_node_key
  ),
  blocker_rows AS (
    SELECT
      rn.template_node_key,
      jsonb_agg(
        DISTINCT jsonb_build_object(
          'node_id', prev.id,
          'node_name', COALESCE(prev.node_name, prev.node_key),
          'status', prev.status
        )
      ) FILTER (WHERE prev.id IS NOT NULL) AS blocking_nodes
    FROM runtime_nodes rn
    JOIN public.approval_edges edge ON edge.to_node_id = rn.id
    JOIN public.approval_nodes prev ON prev.id = edge.from_node_id
    WHERE COALESCE(edge.condition_result, true) = true
      AND prev.status NOT IN ('approved', 'skipped')
    GROUP BY rn.template_node_key
  ),
  grouped AS (
    SELECT
      tn.id AS template_node_id,
      tn.node_key,
      tn.node_name,
      tn.resolver_role,
      tn.approval_policy,
      tn.sort_order,
      min(rn.id) AS first_node_id,
      min(rn.activated_at) FILTER (WHERE rn.activated_at IS NOT NULL) AS activated_at,
      max(rn.completed_at) FILTER (WHERE rn.completed_at IS NOT NULL) AS completed_at,
      bool_or(
        rn.status = 'active'
        AND (
          EXISTS (
            SELECT 1
            FROM public.approval_node_assignees action_assignee
            WHERE action_assignee.node_id = rn.id
              AND action_assignee.status = 'pending'
              AND action_assignee.assignee_user_id = public.current_employee_id()
          )
          OR public.current_user_has_role('admin')
        )
      ) AS can_current_user_act,
      count(rn.id) AS runtime_count,
      bool_or(rn.status = 'rejected') AS has_rejected,
      bool_or(rn.status = 'active') AS has_active,
      bool_or(rn.status IN ('waiting', 'pending', 'waiting_revision', 'needs_revision', 'needs_reapproval')) AS has_waiting,
      bool_or(rn.status = 'approved') AS has_approved,
      bool_and(rn.status IN ('approved', 'skipped', 'cancelled')) FILTER (WHERE rn.id IS NOT NULL) AS all_terminal,
      bool_and(rn.status = 'cancelled') FILTER (WHERE rn.id IS NOT NULL) AS all_cancelled,
      bool_and(rn.status = 'skipped') FILTER (WHERE rn.id IS NOT NULL) AS all_skipped,
      max(rn.result_action) FILTER (WHERE rn.result_action IS NOT NULL) AS result_action,
      max(rn.comment) FILTER (WHERE rn.comment IS NOT NULL AND rn.comment <> '') AS comment
    FROM template_nodes tn
    LEFT JOIN runtime_nodes rn ON rn.template_node_key = tn.node_key
    GROUP BY tn.id, tn.node_key, tn.node_name, tn.resolver_role, tn.approval_policy, tn.sort_order
  )
  SELECT
    COALESCE(g.first_node_id, -g.template_node_id) AS node_id,
    g.node_key,
    g.node_name,
    'template_node'::text AS scope_type,
    g.template_node_id AS scope_id,
    CASE
      WHEN g.runtime_count = 0 THEN 'waiting'
      WHEN g.has_rejected THEN 'rejected'
      WHEN g.has_active THEN 'active'
      WHEN g.has_waiting THEN 'waiting'
      WHEN g.all_cancelled THEN 'cancelled'
      WHEN g.all_skipped THEN 'skipped'
      WHEN g.all_terminal AND g.has_approved THEN 'approved'
      ELSE 'waiting'
    END AS node_status,
    g.resolver_role AS assignee_role,
    g.resolver_role,
    g.approval_policy,
    g.sort_order,
    g.activated_at,
    g.completed_at,
    g.result_action,
    g.comment,
    COALESCE(g.can_current_user_act, false) AS can_current_user_act,
    COALESCE(ra.assignees, '[]'::jsonb) AS assignees,
    COALESCE(br.blocking_nodes, '[]'::jsonb) AS blocking_nodes
  FROM grouped g
  LEFT JOIN runtime_assignees ra ON ra.template_node_key = g.node_key
  LEFT JOIN blocker_rows br ON br.template_node_key = g.node_key
  WHERE (
    public.current_user_can_access_resource('review', 'read')
    OR EXISTS (
      SELECT 1
      FROM public.timesheets t
      WHERE t.id = p_timesheet_id
        AND t.user_id = public.current_employee_id()
    )
  )
  ORDER BY g.sort_order, g.node_key;
$$;

REVOKE ALL ON FUNCTION public.psa_timesheet_approval_chain(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_approval_chain(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
