BEGIN;

DELETE FROM public.approval_template_edges e
USING public.approval_templates t
WHERE e.template_id = t.id
  AND t.template_key IN (
    'contract_approval_pm_v1',
    'contract_approval_cc_v1',
    'contract_approval_pmcc_v1'
  )
  AND (
    e.from_node_key = 'special_department_owner'
    OR e.to_node_key = 'special_department_owner'
  );

DELETE FROM public.approval_template_nodes n
USING public.approval_templates t
WHERE n.template_id = t.id
  AND t.template_key IN (
    'contract_approval_pm_v1',
    'contract_approval_cc_v1',
    'contract_approval_pmcc_v1'
  )
  AND n.node_key = 'special_department_owner';

UPDATE public.approval_templates
SET name = '请假/特殊项目块确认'
WHERE template_key = 'timesheet_special_department_owner_v1';

UPDATE public.approval_template_nodes n
SET node_name = '所属部门负责人确认',
    resolver_type = 'org_manager',
    resolver_role = 'department_owner',
    approval_policy = 'single',
    reject_policy = 'back_to_creator',
    sort_order = 20,
    scope_strategy = 'per_project',
    scope_source = 'timesheet_projects',
    runtime_scope_type = 'project',
    runtime_node_key_template = 'project_{scope_id}_{node_key}',
    missing_assignee_policy = 'required'
FROM public.approval_templates t
WHERE n.template_id = t.id
  AND t.template_key = 'timesheet_special_department_owner_v1'
  AND n.node_key = 'special_department_owner';

CREATE OR REPLACE FUNCTION public.psa_save_approval_template(
  p_template_id bigint,
  p_name text,
  p_status text,
  p_version integer,
  p_nodes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_template record;
  v_node record;
  v_bad_count int;
  v_previous_key text;
BEGIN
  IF NOT public.current_user_can_access_resource('approval_config', 'write') THEN
    RAISE EXCEPTION 'Missing approval_config write permission' USING ERRCODE = '42501';
  END IF;

  IF p_template_id IS NULL OR p_template_id <= 0 THEN
    RAISE EXCEPTION 'Template id is required';
  END IF;

  IF jsonb_typeof(COALESCE(p_nodes, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Template nodes must be a JSON array';
  END IF;

  SELECT *
    INTO v_template
  FROM public.approval_templates
  WHERE id = p_template_id
  FOR UPDATE;

  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'Approval template not found';
  END IF;

  DROP TABLE IF EXISTS pg_temp.approval_template_save_nodes;
  CREATE TEMP TABLE approval_template_save_nodes ON COMMIT DROP AS
  SELECT
    ordinality::int AS payload_order,
    CASE
      WHEN COALESCE(item ->> 'id', '') ~ '^[0-9]+$' THEN (item ->> 'id')::bigint
      ELSE NULL
    END AS id,
    btrim(COALESCE(item ->> 'node_key', '')) AS node_key,
    btrim(COALESCE(item ->> 'node_name', '')) AS node_name,
    COALESCE(NULLIF(item ->> 'node_type', ''), 'approval') AS node_type,
    COALESCE(NULLIF(item ->> 'resolver_type', ''), '') AS resolver_type,
    NULLIF(item ->> 'resolver_role', '') AS resolver_role,
    COALESCE(NULLIF(item ->> 'approval_policy', ''), 'single') AS approval_policy,
    COALESCE(NULLIF(item ->> 'reject_policy', ''), 'back_to_creator') AS reject_policy,
    COALESCE((item ->> 'allow_delegate')::boolean, false) AS allow_delegate,
    COALESCE((item ->> 'allow_skip')::boolean, false) AS allow_skip,
    COALESCE((item ->> 'sort_order')::int, ordinality::int * 10) AS sort_order,
    COALESCE(NULLIF(item ->> 'scope_strategy', ''), 'per_project') AS scope_strategy,
    COALESCE(NULLIF(item ->> 'scope_source', ''), 'timesheet_projects') AS scope_source,
    NULLIF(item ->> 'runtime_scope_type', '') AS runtime_scope_type,
    COALESCE(NULLIF(item ->> 'runtime_node_key_template', ''), 'project_{scope_id}_{node_key}') AS runtime_node_key_template,
    COALESCE(NULLIF(item ->> 'missing_assignee_policy', ''), 'skip') AS missing_assignee_policy
  FROM jsonb_array_elements(COALESCE(p_nodes, '[]'::jsonb)) WITH ORDINALITY AS payload(item, ordinality);

  UPDATE pg_temp.approval_template_save_nodes
  SET sort_order = payload_order * 10;

  UPDATE pg_temp.approval_template_save_nodes
  SET scope_strategy = 'submitter_virtual',
      scope_source = 'document',
      runtime_scope_type = NULL,
      runtime_node_key_template = '{node_key}',
      missing_assignee_policy = 'required'
  WHERE resolver_type = 'document_creator'
     OR COALESCE(resolver_role, '') = 'submitter';

  SELECT count(*) INTO v_bad_count
  FROM pg_temp.approval_template_save_nodes
  WHERE node_key = ''
     OR node_name = ''
     OR resolver_type NOT IN ('project_role', 'org_manager', 'fixed_user', 'document_creator', 'expression_limited')
     OR approval_policy NOT IN ('single', 'all', 'any', 'auto_pass')
     OR scope_strategy NOT IN ('once_per_document', 'per_project', 'submitter_virtual')
     OR scope_source NOT IN ('document', 'timesheet_projects', 'context_project')
     OR missing_assignee_policy NOT IN ('required', 'skip', 'admin_fallback', 'auto_approve');

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'Approval template contains invalid or incomplete nodes';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM (
    SELECT node_key
    FROM pg_temp.approval_template_save_nodes
    GROUP BY node_key
    HAVING count(*) > 1
  ) duplicates;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'Approval template node keys must be unique';
  END IF;

  IF v_template.template_key IN (
      'contract_approval_pm_v1',
      'contract_approval_cc_v1',
      'contract_approval_pmcc_v1'
    ) THEN
    IF EXISTS (
      SELECT 1
      FROM pg_temp.approval_template_save_nodes
      WHERE node_key = 'special_department_owner'
    ) THEN
      RAISE EXCEPTION 'Normal approval templates cannot contain special_department_owner';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_temp.approval_template_save_nodes
      WHERE resolver_type = 'document_creator'
         OR COALESCE(resolver_role, '') = 'submitter'
    ) THEN
      RAISE EXCEPTION 'Normal approval templates must contain a submitter node';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_temp.approval_template_save_nodes
      WHERE resolver_type <> 'document_creator'
        AND COALESCE(resolver_role, '') <> 'submitter'
    ) THEN
      RAISE EXCEPTION 'Normal approval templates must contain at least one approval node';
    END IF;
  END IF;

  IF v_template.template_key = 'timesheet_special_department_owner_v1' THEN
    IF (SELECT count(*) FROM pg_temp.approval_template_save_nodes) <> 1
       OR NOT EXISTS (
         SELECT 1
         FROM pg_temp.approval_template_save_nodes
         WHERE node_key = 'special_department_owner'
           AND resolver_type = 'org_manager'
           AND resolver_role = 'department_owner'
       ) THEN
      RAISE EXCEPTION 'Special timesheet template only supports department-owner confirmation';
    END IF;
  END IF;

  UPDATE public.approval_templates
  SET name = COALESCE(NULLIF(p_name, ''), name),
      status = COALESCE(NULLIF(p_status, ''), 'active'),
      version = COALESCE(p_version, version)
  WHERE id = p_template_id;

  DELETE FROM public.approval_template_edges
  WHERE template_id = p_template_id;

  DELETE FROM public.approval_template_nodes existing
  WHERE existing.template_id = p_template_id
    AND NOT EXISTS (
      SELECT 1
      FROM pg_temp.approval_template_save_nodes desired
      WHERE desired.node_key = existing.node_key
    );

  FOR v_node IN
    SELECT *
    FROM pg_temp.approval_template_save_nodes
    ORDER BY sort_order, payload_order
  LOOP
    INSERT INTO public.approval_template_nodes(
      template_id, node_key, node_name, node_type, resolver_type, resolver_role,
      approval_policy, reject_policy, allow_delegate, allow_skip, sort_order,
      scope_strategy, scope_source, runtime_scope_type, runtime_node_key_template,
      missing_assignee_policy
    )
    VALUES (
      p_template_id, v_node.node_key, v_node.node_name, v_node.node_type,
      v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
      v_node.reject_policy, v_node.allow_delegate, v_node.allow_skip,
      v_node.sort_order, v_node.scope_strategy, v_node.scope_source,
      v_node.runtime_scope_type, v_node.runtime_node_key_template,
      v_node.missing_assignee_policy
    )
    ON CONFLICT (template_id, node_key) DO UPDATE
    SET node_name = EXCLUDED.node_name,
        node_type = EXCLUDED.node_type,
        resolver_type = EXCLUDED.resolver_type,
        resolver_role = EXCLUDED.resolver_role,
        approval_policy = EXCLUDED.approval_policy,
        reject_policy = EXCLUDED.reject_policy,
        allow_delegate = EXCLUDED.allow_delegate,
        allow_skip = EXCLUDED.allow_skip,
        sort_order = EXCLUDED.sort_order,
        scope_strategy = EXCLUDED.scope_strategy,
        scope_source = EXCLUDED.scope_source,
        runtime_scope_type = EXCLUDED.runtime_scope_type,
        runtime_node_key_template = EXCLUDED.runtime_node_key_template,
        missing_assignee_policy = EXCLUDED.missing_assignee_policy;
  END LOOP;

  v_previous_key := NULL;
  FOR v_node IN
    SELECT node_key
    FROM pg_temp.approval_template_save_nodes
    ORDER BY sort_order, payload_order
  LOOP
    IF v_previous_key IS NOT NULL THEN
      INSERT INTO public.approval_template_edges(
        template_id, from_node_key, to_node_key, condition_expr, edge_type, scope_join_policy
      )
      VALUES (p_template_id, v_previous_key, v_node.node_key, '{}'::jsonb, 'normal', 'same_scope');
    END IF;
    v_previous_key := v_node.node_key;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_expand_approval_template(
  p_document_id bigint,
  p_instance_id bigint,
  p_round_id bigint,
  p_template_id bigint,
  p_business_id bigint,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_doc record;
  v_node record;
  v_scope record;
  v_node_key text;
  v_scope_type text;
  v_scope_id bigint;
  v_edge record;
  v_special_template_id bigint;
BEGIN
  SELECT bd.document_type, bd.business_id
    INTO v_doc
    FROM public.business_documents bd
   WHERE bd.id = p_document_id;

  IF v_doc.document_type IS NULL THEN
    RAISE EXCEPTION 'No approval business_document found for id=%', p_document_id;
  END IF;

  FOR v_node IN
    SELECT *
    FROM public.approval_template_nodes
    WHERE template_id = p_template_id
    ORDER BY sort_order, node_key
  LOOP
    IF COALESCE(v_node.scope_strategy, 'once_per_document') = 'submitter_virtual' THEN
      CONTINUE;
    END IF;

    IF COALESCE(v_node.scope_strategy, 'once_per_document') = 'per_project'
       AND COALESCE(v_node.scope_source, 'document') = 'timesheet_projects' THEN
      FOR v_scope IN
        SELECT DISTINCT te.project_id AS scope_id
        FROM public.timesheet_entries te
        WHERE te.timesheet_id = p_business_id
          AND te.project_id IS NOT NULL
          AND (
            (
              v_node.node_key = 'special_department_owner'
              AND public.psa_is_timesheet_special_project(te.project_id)
            )
            OR (
              v_node.node_key <> 'special_department_owner'
              AND NOT public.psa_is_timesheet_special_project(te.project_id)
            )
          )
        ORDER BY te.project_id
      LOOP
        v_scope_id := v_scope.scope_id;
        v_scope_type := COALESCE(NULLIF(v_node.runtime_scope_type, ''), 'project');
        v_node_key := replace(
          replace(COALESCE(NULLIF(v_node.runtime_node_key_template, ''), '{node_key}'), '{node_key}', v_node.node_key),
          '{scope_id}',
          v_scope_id::text
        );

        INSERT INTO public.approval_nodes (
          round_id, instance_id, node_key, template_node_key, node_name, node_type,
          scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
          reject_policy, snapshot, metadata, scope_strategy, missing_assignee_policy
        )
        VALUES (
          p_round_id, p_instance_id, v_node_key, v_node.node_key, v_node.node_name, v_node.node_type,
          v_scope_type, v_scope_id, 'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
          v_node.reject_policy,
          to_jsonb(v_node) || jsonb_build_object('project_id', v_scope_id),
          to_jsonb(v_node) || jsonb_build_object(
            'project_id', v_scope_id,
            'template_driven_timesheet', true,
            'template_key', (SELECT template_key FROM public.approval_templates WHERE id = p_template_id),
            'special_timesheet_project', v_node.node_key = 'special_department_owner'
          ),
          v_node.scope_strategy,
          v_node.missing_assignee_policy
        );
      END LOOP;
    ELSE
      v_scope_id := NULLIF((p_context ->> 'scope_id')::bigint, 0);
      v_scope_type := COALESCE(NULLIF(v_node.runtime_scope_type, ''), v_doc.document_type);
      v_node_key := replace(
        replace(COALESCE(NULLIF(v_node.runtime_node_key_template, ''), '{node_key}'), '{node_key}', v_node.node_key),
        '{scope_id}',
        COALESCE(v_scope_id::text, '')
      );

      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, snapshot, metadata, scope_strategy, missing_assignee_policy
      )
      VALUES (
        p_round_id, p_instance_id, v_node_key, v_node.node_key, v_node.node_name, v_node.node_type,
        v_scope_type, v_scope_id, 'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
        v_node.reject_policy,
        to_jsonb(v_node),
        to_jsonb(v_node) || jsonb_build_object(
          'template_key', (SELECT template_key FROM public.approval_templates WHERE id = p_template_id)
        ),
        v_node.scope_strategy,
        v_node.missing_assignee_policy
      );
    END IF;
  END LOOP;

  IF v_doc.document_type = 'timesheet' THEN
    SELECT id INTO v_special_template_id
    FROM public.approval_templates
    WHERE template_key = 'timesheet_special_department_owner_v1'
      AND status = 'active'
    LIMIT 1;

    IF v_special_template_id IS NOT NULL
       AND v_special_template_id <> p_template_id
       AND EXISTS (
         SELECT 1
         FROM public.timesheet_entries te
         WHERE te.timesheet_id = p_business_id
           AND te.project_id IS NOT NULL
           AND public.psa_is_timesheet_special_project(te.project_id)
       ) THEN
      FOR v_node IN
        SELECT *
        FROM public.approval_template_nodes
        WHERE template_id = v_special_template_id
        ORDER BY sort_order, node_key
      LOOP
        IF COALESCE(v_node.scope_strategy, 'once_per_document') = 'submitter_virtual' THEN
          CONTINUE;
        END IF;

        FOR v_scope IN
          SELECT DISTINCT te.project_id AS scope_id
          FROM public.timesheet_entries te
          WHERE te.timesheet_id = p_business_id
            AND te.project_id IS NOT NULL
            AND public.psa_is_timesheet_special_project(te.project_id)
          ORDER BY te.project_id
        LOOP
          v_scope_id := v_scope.scope_id;
          v_scope_type := COALESCE(NULLIF(v_node.runtime_scope_type, ''), 'project');
          v_node_key := replace(
            replace(COALESCE(NULLIF(v_node.runtime_node_key_template, ''), '{node_key}'), '{node_key}', v_node.node_key),
            '{scope_id}',
            v_scope_id::text
          );

          INSERT INTO public.approval_nodes (
            round_id, instance_id, node_key, template_node_key, node_name, node_type,
            scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
            reject_policy, snapshot, metadata, scope_strategy, missing_assignee_policy
          )
          VALUES (
            p_round_id, p_instance_id, v_node_key, v_node.node_key, v_node.node_name, v_node.node_type,
            v_scope_type, v_scope_id, 'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
            v_node.reject_policy,
            to_jsonb(v_node) || jsonb_build_object('project_id', v_scope_id),
            to_jsonb(v_node) || jsonb_build_object(
              'project_id', v_scope_id,
              'template_driven_timesheet', true,
              'template_key', 'timesheet_special_department_owner_v1',
              'special_timesheet_project', true
            ),
            v_node.scope_strategy,
            v_node.missing_assignee_policy
          )
          ON CONFLICT DO NOTHING;
        END LOOP;
      END LOOP;
    END IF;
  END IF;

  FOR v_edge IN
    SELECT *
    FROM public.approval_template_edges
    WHERE template_id = p_template_id
  LOOP
    INSERT INTO public.approval_edges (
      round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type, condition_expr
    )
    SELECT
      p_round_id,
      p_instance_id,
      from_node.id,
      to_node.id,
      v_edge.edge_type,
      v_edge.edge_type,
      v_edge.condition_expr
    FROM public.approval_nodes from_node
    JOIN public.approval_nodes to_node
      ON to_node.round_id = p_round_id
     AND to_node.template_node_key = v_edge.to_node_key
     AND to_node.scope_type = from_node.scope_type
     AND to_node.scope_id IS NOT DISTINCT FROM from_node.scope_id
    WHERE from_node.round_id = p_round_id
      AND from_node.template_node_key = v_edge.from_node_key
      AND COALESCE(v_edge.scope_join_policy, 'same_scope') = 'same_scope'
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

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
  runtime_nodes AS (
    SELECT
      n.*,
      i.document_id,
      p.code AS project_code,
      p.name AS project_name,
      CASE
        WHEN n.scope_type = 'project' THEN 'project'
        WHEN n.scope_type = 'department_summary' THEN 'department_summary'
        ELSE COALESCE(NULLIF(n.scope_type, ''), 'template_node')
      END AS projection_scope_type,
      CASE
        WHEN n.scope_type = 'project' THEN 0
        WHEN n.scope_type = 'department_summary' THEN 1
        ELSE 0
      END AS projection_scope_rank
    FROM instance_row i
    JOIN public.approval_nodes n ON n.instance_id = i.id
    LEFT JOIN public.projects p ON p.id = n.scope_id AND n.scope_type = 'project'
  ),
  template_nodes AS (
    SELECT
      tn.id,
      tn.node_key,
      tn.node_name,
      tn.resolver_role,
      tn.approval_policy,
      tn.sort_order
    FROM instance_row i
    JOIN public.approval_template_nodes tn ON tn.template_id = i.template_id
    WHERE tn.node_type = 'approval'
      AND tn.resolver_type <> 'document_creator'
      AND COALESCE(tn.resolver_role, '') <> 'submitter'
    UNION ALL
    SELECT
      -min(rn.id) AS id,
      rn.template_node_key AS node_key,
      max(rn.node_name) AS node_name,
      max(rn.resolver_role) AS resolver_role,
      max(rn.approval_policy) AS approval_policy,
      max(COALESCE(NULLIF(rn.snapshot ->> 'sort_order', '')::integer, 90)) AS sort_order
    FROM runtime_nodes rn
    WHERE NOT EXISTS (
      SELECT 1
      FROM instance_row i
      JOIN public.approval_template_nodes tn ON tn.template_id = i.template_id
      WHERE tn.node_key = rn.template_node_key
    )
      AND rn.node_type = 'approval'
      AND rn.resolver_type <> 'document_creator'
      AND COALESCE(rn.resolver_role, '') <> 'submitter'
    GROUP BY rn.template_node_key
  ),
  runtime_assignees AS (
    SELECT
      rn.template_node_key,
      rn.projection_scope_type,
      jsonb_agg(
        jsonb_build_object(
          'node_id', rn.id,
          'node_name', rn.node_name,
          'node_status', rn.status,
          'scope_type', rn.scope_type,
          'scope_id', rn.scope_id,
          'project_id', CASE WHEN rn.scope_type = 'project' THEN rn.scope_id ELSE NULL END,
          'project_code', COALESCE(rn.project_code, ''),
          'project_name', COALESCE(rn.project_name, ''),
          'assignee_user_id', COALESCE(NULLIF(a.assignee_user_id, 0), rn.assignee_user_id, dyn.assignee_user_id, 0),
          'assignee_name', e.name,
          'assignee_route_source', COALESCE(dyn.route_source, rn.snapshot ->> 'route_source', rn.assignee_role, rn.resolver_role),
          'status', COALESCE(a.status, rn.status),
          'action', COALESCE(a.action, rn.result_action),
          'comment', COALESCE(a.comment, rn.comment),
          'acted_at', a.acted_at,
          'template_key', COALESCE(rn.metadata ->> 'template_key', rn.snapshot ->> 'template_key')
        )
        ORDER BY rn.id, a.id NULLS LAST
      ) FILTER (WHERE rn.id IS NOT NULL) AS assignees
    FROM runtime_nodes rn
    LEFT JOIN public.approval_node_assignees a ON a.node_id = rn.id
    LEFT JOIN LATERAL public.psa_resolve_graph_assignees(
      rn.document_id,
      rn.resolver_type,
      rn.resolver_role,
      rn.scope_id,
      false
    ) dyn ON COALESCE(rn.status, '') IN ('waiting', 'pending', 'active', 'needs_reapproval', 'skipped')
      AND (
        a.id IS NULL
        OR COALESCE(a.assignee_user_id, 0) = 0
      )
    LEFT JOIN public.employees e ON e.id = COALESCE(NULLIF(a.assignee_user_id, 0), rn.assignee_user_id, dyn.assignee_user_id)
    GROUP BY rn.template_node_key, rn.projection_scope_type
  ),
  blocker_rows AS (
    SELECT
      rn.template_node_key,
      rn.projection_scope_type,
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
    GROUP BY rn.template_node_key, rn.projection_scope_type
  ),
  grouped AS (
    SELECT
      tn.id AS template_node_id,
      tn.node_key,
      tn.node_name,
      tn.resolver_role,
      tn.approval_policy,
      tn.sort_order,
      rn.projection_scope_type,
      min(rn.projection_scope_rank) AS projection_scope_rank,
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
    GROUP BY
      tn.id,
      tn.node_key,
      tn.node_name,
      tn.resolver_role,
      tn.approval_policy,
      tn.sort_order,
      rn.projection_scope_type
  )
  SELECT
    COALESCE(g.first_node_id, -g.template_node_id) AS node_id,
    g.node_key,
    g.node_name,
    COALESCE(g.projection_scope_type, 'template_node') AS scope_type,
    NULL::bigint AS scope_id,
    CASE
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
    (g.sort_order * 10 + COALESCE(g.projection_scope_rank, 0))::integer AS sort_order,
    g.activated_at,
    g.completed_at,
    g.result_action,
    g.comment,
    COALESCE(g.can_current_user_act, false) AS can_current_user_act,
    COALESCE(ra.assignees, '[]'::jsonb) AS assignees,
    COALESCE(br.blocking_nodes, '[]'::jsonb) AS blocking_nodes
  FROM grouped g
  LEFT JOIN runtime_assignees ra
    ON ra.template_node_key = g.node_key
   AND ra.projection_scope_type = g.projection_scope_type
  LEFT JOIN blocker_rows br
    ON br.template_node_key = g.node_key
   AND br.projection_scope_type = g.projection_scope_type
  WHERE g.runtime_count > 0
    AND (
      public.current_user_can_access_resource('review', 'read')
      OR EXISTS (
        SELECT 1
        FROM public.timesheets t
        WHERE t.id = p_timesheet_id
          AND t.user_id = public.current_employee_id()
      )
    )
  ORDER BY g.sort_order, COALESCE(g.projection_scope_rank, 0), g.node_key;
$$;

REVOKE ALL ON FUNCTION public.psa_save_approval_template(bigint, text, text, integer, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_approval_template(bigint, text, text, integer, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.psa_expand_approval_template(bigint, bigint, bigint, bigint, bigint, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_expand_approval_template(bigint, bigint, bigint, bigint, bigint, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.psa_timesheet_approval_chain(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_approval_chain(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
