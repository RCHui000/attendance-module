BEGIN;

CREATE OR REPLACE FUNCTION public.psa_is_timesheet_special_project(p_project_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND (
        p.code IN (U&'\8BF7\5047', U&'\5176\4ED6')
        OR p.name IN (U&'\8BF7\5047', U&'\5176\4ED6')
      )
  );
$$;

WITH special_template AS (
  INSERT INTO public.approval_templates(
    template_key, document_type, business_type, name, version, status
  )
  VALUES (
    'timesheet_special_department_owner_v1',
    'timesheet_project',
    NULL,
    'Timesheet Special Project Department Owner',
    1,
    'active'
  )
  ON CONFLICT (template_key) DO UPDATE
  SET document_type = EXCLUDED.document_type,
      business_type = EXCLUDED.business_type,
      name = EXCLUDED.name,
      version = EXCLUDED.version,
      status = EXCLUDED.status
  RETURNING id
)
INSERT INTO public.approval_template_nodes(
  template_id, node_key, node_name, node_type, resolver_type, resolver_role,
  approval_policy, reject_policy, allow_delegate, allow_skip, sort_order,
  scope_strategy, scope_source, runtime_scope_type, runtime_node_key_template,
  missing_assignee_policy
)
SELECT
  id,
  'special_department_owner',
  'Special Project Department Owner',
  'approval',
  'org_manager',
  'department_owner',
  'single',
  'back_to_creator',
  false,
  false,
  15,
  'per_project',
  'timesheet_projects',
  'project',
  'project_{scope_id}_{node_key}',
  'required'
FROM special_template
ON CONFLICT (template_id, node_key) DO UPDATE
SET node_name = EXCLUDED.node_name,
    resolver_type = EXCLUDED.resolver_type,
    resolver_role = EXCLUDED.resolver_role,
    approval_policy = EXCLUDED.approval_policy,
    reject_policy = EXCLUDED.reject_policy,
    sort_order = EXCLUDED.sort_order,
    scope_strategy = EXCLUDED.scope_strategy,
    scope_source = EXCLUDED.scope_source,
    runtime_scope_type = EXCLUDED.runtime_scope_type,
    runtime_node_key_template = EXCLUDED.runtime_node_key_template,
    missing_assignee_policy = EXCLUDED.missing_assignee_policy;

WITH contract_templates AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key IN (
    'contract_approval_pm_v1',
    'contract_approval_cc_v1',
    'contract_approval_pmcc_v1'
  )
)
INSERT INTO public.approval_template_nodes(
  template_id, node_key, node_name, node_type, resolver_type, resolver_role,
  approval_policy, reject_policy, allow_delegate, allow_skip, sort_order,
  scope_strategy, scope_source, runtime_scope_type, runtime_node_key_template,
  missing_assignee_policy
)
SELECT
  id,
  'special_department_owner',
  'Special Project Department Owner',
  'approval',
  'org_manager',
  'department_owner',
  'single',
  'back_to_creator',
  false,
  false,
  15,
  'per_project',
  'timesheet_projects',
  'project',
  'project_{scope_id}_{node_key}',
  'required'
FROM contract_templates
ON CONFLICT (template_id, node_key) DO UPDATE
SET node_name = EXCLUDED.node_name,
    resolver_type = EXCLUDED.resolver_type,
    resolver_role = EXCLUDED.resolver_role,
    approval_policy = EXCLUDED.approval_policy,
    reject_policy = EXCLUDED.reject_policy,
    sort_order = EXCLUDED.sort_order,
    scope_strategy = EXCLUDED.scope_strategy,
    scope_source = EXCLUDED.scope_source,
    runtime_scope_type = EXCLUDED.runtime_scope_type,
    runtime_node_key_template = EXCLUDED.runtime_node_key_template,
    missing_assignee_policy = EXCLUDED.missing_assignee_policy;

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
        to_jsonb(v_node),
        v_node.scope_strategy,
        v_node.missing_assignee_policy
      );
    END IF;
  END LOOP;

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

REVOKE ALL ON FUNCTION public.psa_is_timesheet_special_project(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_is_timesheet_special_project(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
