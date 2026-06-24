BEGIN;

-- PMCC is now treated as a cross-department collaboration route:
-- source-side project owner -> source-side department owner ->
-- PM specialty owner -> PM project owner -> PM department owner.
WITH pmcc_template AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key = 'contract_approval_pmcc_v1'
    AND status = 'active'
  LIMIT 1
)
DELETE FROM public.approval_template_edges e
USING pmcc_template t
WHERE e.template_id = t.id;

WITH pmcc_template AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key = 'contract_approval_pmcc_v1'
    AND status = 'active'
  LIMIT 1
),
edges(from_node_key, to_node_key, sort_no) AS (
  VALUES
    ('cc_submitter', 'cc_project_owner', 10),
    ('cc_project_owner', 'cc_department_owner', 20),
    ('cc_department_owner', 'pm_cost_department_owner', 30),
    ('pm_cost_department_owner', 'pm_project_owner', 40),
    ('pm_project_owner', 'pm_department_owner', 50)
)
INSERT INTO public.approval_template_edges(
  template_id, from_node_key, to_node_key, edge_type, condition_expr, scope_join_policy
)
SELECT t.id, e.from_node_key, e.to_node_key, 'normal', '{}'::jsonb, 'same_scope'
FROM pmcc_template t
JOIN edges e ON true
ORDER BY e.sort_no
ON CONFLICT (template_id, from_node_key, to_node_key, edge_type)
DO UPDATE SET scope_join_policy = EXCLUDED.scope_join_policy;

-- Prefer the submitter-side specialty role when a generic source-side project
-- owner node is expanded. The generic cc_project_owner fallback stays available.
UPDATE public.approval_role_aliases
SET priority = 100,
    updated_at = now()
WHERE resolver_type = 'project_role'
  AND requested_role_key = 'cc_project_owner'
  AND candidate_role_key = 'cc_project_owner'
  AND business_type IS NULL
  AND org_code IS NULL
  AND parent_org_code IS NULL
  AND cost_specialty IS NULL;

WITH aliases(document_type, requested_role_key, candidate_role_key, business_type, org_code, parent_org_code, cost_specialty, priority) AS (
  VALUES
    ('timesheet', 'cc_project_owner', 'cc_civil_project_owner', NULL, NULL, NULL, 'civil', 5),
    ('timesheet', 'cc_project_owner', 'cc_mep_project_owner', NULL, NULL, NULL, 'mep', 5),
    ('timesheet', 'cc_project_owner', 'cc_design_project_owner', NULL, 'PM_DESIGN', NULL, NULL, 5),
    ('timesheet', 'cc_project_owner', 'cc_design_project_owner', NULL, NULL, 'TEO', NULL, 15),
    ('timesheet', 'pm_cost_department_owner', 'pm_design_project_owner', NULL, 'PM_DESIGN', NULL, NULL, 5),
    ('timesheet', 'pm_cost_department_owner', 'pm_design_project_owner', NULL, NULL, 'TEO', NULL, 15)
)
INSERT INTO public.approval_role_aliases(
  document_type, resolver_type, requested_role_key, candidate_role_key,
  business_type, org_code, parent_org_code, cost_specialty, priority, is_active
)
SELECT
  document_type, 'project_role', requested_role_key, candidate_role_key,
  business_type, org_code, parent_org_code, cost_specialty, priority, true
FROM aliases a
WHERE NOT EXISTS (
  SELECT 1
  FROM public.approval_role_aliases existing
  WHERE existing.document_type IS NOT DISTINCT FROM a.document_type
    AND existing.resolver_type = 'project_role'
    AND existing.requested_role_key = a.requested_role_key
    AND existing.candidate_role_key = a.candidate_role_key
    AND existing.business_type IS NOT DISTINCT FROM a.business_type
    AND existing.org_code IS NOT DISTINCT FROM a.org_code
    AND existing.parent_org_code IS NOT DISTINCT FROM a.parent_org_code
    AND existing.cost_specialty IS NOT DISTINCT FROM a.cost_specialty
);

CREATE OR REPLACE FUNCTION public.psa_activate_ready_nodes(p_round_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_node record;
  v_route record;
  v_next_node record;
  v_next_route record;
  v_assignee_user_id bigint;
  v_route_source text;
  v_matched_org_id bigint;
  v_missing_policy text;
  v_creator_user_id bigint;
  v_progress boolean;
BEGIN
  LOOP
    v_progress := false;

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
      ORDER BY n.id
    LOOP
      v_progress := true;
      v_assignee_user_id := NULL;
      v_route_source := NULL;
      v_matched_org_id := NULL;
      v_creator_user_id := NULL;
      v_missing_policy := COALESCE(
        NULLIF(v_node.missing_assignee_policy, ''),
        CASE WHEN COALESCE(v_node.metadata ->> 'optional', 'false') = 'true' THEN 'skip' ELSE 'required' END
      );

      SELECT bd.creator_user_id
        INTO v_creator_user_id
      FROM public.approval_instances ai
      JOIN public.business_documents bd ON bd.id = ai.document_id
      WHERE ai.id = v_node.instance_id
      LIMIT 1;

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
            v_node.scope_id,
            v_missing_policy <> 'skip'
          )
          LIMIT 1;

          v_assignee_user_id := v_route.assignee_user_id;
          v_route_source := v_route.route_source;
          v_matched_org_id := v_route.matched_org_id;
        END IF;

        IF v_assignee_user_id IS NULL THEN
          IF v_missing_policy = 'skip' THEN
            UPDATE public.approval_nodes
            SET status = 'skipped',
                result_action = 'skipped',
                completed_at = now(),
                comment = COALESCE(NULLIF(comment, ''), 'No configured approver; optional node skipped'),
                snapshot = snapshot || jsonb_build_object('route_source', 'optional_unresolved_skipped'),
                updated_at = now()
            WHERE id = v_node.id;
            CONTINUE;
          ELSIF v_missing_policy = 'auto_approve' THEN
            UPDATE public.approval_nodes
            SET status = 'approved',
                result_action = 'approve',
                completed_at = now(),
                comment = COALESCE(NULLIF(comment, ''), 'No configured approver; auto-approved by policy'),
                snapshot = snapshot || jsonb_build_object('route_source', 'auto_approve_no_assignee'),
                updated_at = now()
            WHERE id = v_node.id;
            CONTINUE;
          END IF;

          RAISE EXCEPTION 'No assignee resolved for node %', v_node.node_key;
        END IF;

        IF v_assignee_user_id = v_creator_user_id THEN
          UPDATE public.approval_nodes
          SET status = 'skipped',
              result_action = 'skipped',
              completed_at = now(),
              comment = 'Submitter is assignee; node auto-skipped',
              assignee_user_id = v_assignee_user_id,
              assignee_role = COALESCE(assignee_role, resolver_role),
              snapshot = snapshot || jsonb_build_object(
                'resolved_assignee_user_id', v_assignee_user_id,
                'route_source', v_route_source,
                'matched_org_id', v_matched_org_id,
                'auto_skip_reason', 'submitter_is_assignee'
              ),
              updated_at = now()
          WHERE id = v_node.id;
          CONTINUE;
        END IF;

        SELECT to_node.*
          INTO v_next_node
        FROM public.approval_edges e
        JOIN public.approval_nodes to_node ON to_node.id = e.to_node_id
        WHERE e.round_id = p_round_id
          AND e.from_node_id = v_node.id
          AND e.condition_result = true
          AND to_node.status IN ('waiting', 'pending')
        ORDER BY to_node.id
        LIMIT 1;

        IF v_next_node.id IS NOT NULL THEN
          SELECT * INTO v_next_route
          FROM public.psa_resolve_graph_assignees(
            (SELECT ai.document_id FROM public.approval_instances ai WHERE ai.id = v_node.instance_id),
            v_next_node.resolver_type,
            v_next_node.resolver_role,
            v_next_node.scope_id,
            false
          )
          LIMIT 1;

          IF v_next_route.assignee_user_id IS NOT NULL
             AND v_next_route.assignee_user_id = v_assignee_user_id THEN
            UPDATE public.approval_nodes
            SET status = 'skipped',
                result_action = 'skipped',
                completed_at = now(),
                comment = 'Next approval node has same assignee; lower node auto-skipped',
                assignee_user_id = v_assignee_user_id,
                assignee_role = COALESCE(assignee_role, resolver_role),
                snapshot = snapshot || jsonb_build_object(
                  'resolved_assignee_user_id', v_assignee_user_id,
                  'route_source', v_route_source,
                  'matched_org_id', v_matched_org_id,
                  'auto_skip_reason', 'next_node_same_assignee',
                  'next_node_id', v_next_node.id
                ),
                updated_at = now()
            WHERE id = v_node.id;
            CONTINUE;
          END IF;
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

    EXIT WHEN NOT v_progress;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
