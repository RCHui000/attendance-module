BEGIN;

-- A source-department owner must not be sent backwards to a subordinate
-- source project owner. Resolve the source-side project-owner node to the
-- submitter so the approval engine's existing self-assignee rule skips it.
CREATE OR REPLACE FUNCTION public.psa_resolve_graph_assignees(
  p_document_id bigint,
  p_resolver_type text,
  p_resolver_role text,
  p_scope_id bigint,
  p_allow_admin_fallback boolean
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
  role_candidates AS (
    SELECT *
    FROM public.psa_resolve_role_candidates(p_document_id, p_resolver_type, p_resolver_role, p_scope_id)
  ),
  department_owner_submitter AS (
    SELECT
      d.creator_user_id AS assignee_user_id,
      'department_owner_submitter'::text AS route_source,
      d.org_id AS matched_org_id,
      0 AS source_priority,
      0 AS role_priority
    FROM doc d
    JOIN public.organization_managers om
      ON om.org_id = d.org_id
     AND om.employee_id = d.creator_user_id
     AND om.manager_role = 'department_owner'
     AND om.is_active = true
    WHERE d.document_type = 'timesheet'
      AND d.org_code = 'CC'
      AND p_resolver_type = 'project_role'
      AND p_resolver_role IN (
        'cc_project_owner',
        'cc_civil_project_owner',
        'cc_mep_project_owner'
      )
    LIMIT 1
  ),
  project_role_match AS (
    SELECT
      pr.user_id AS assignee_user_id,
      'project_roles:' || pr.role_key AS route_source,
      pr.org_id AS matched_org_id,
      1 AS source_priority,
      rc.priority AS role_priority
    FROM doc d
    JOIN role_candidates rc ON true
    JOIN public.project_roles pr
      ON pr.project_id = COALESCE(NULLIF(p_scope_id, 0), d.project_id)
     AND pr.role_key = rc.candidate_role_key
    WHERE p_resolver_type = 'project_role'
      AND pr.status = 'active'
      AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
      AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
    ORDER BY rc.priority, pr.org_id NULLS LAST, pr.id DESC
    LIMIT 1
  ),
  timesheet_project_owner AS (
    SELECT
      route.assignee_user_id,
      'timesheet_route:' || route.assignee_role AS route_source,
      NULL::bigint AS matched_org_id,
      3 AS source_priority,
      rc.priority AS role_priority
    FROM doc d
    JOIN role_candidates rc ON true
    JOIN LATERAL public.psa_resolve_timesheet_project_assignees(d.business_id) route
      ON route.project_id = COALESCE(NULLIF(p_scope_id, 0), d.project_id)
     AND route.assignee_role = rc.candidate_role_key
    WHERE p_resolver_type = 'project_role'
      AND d.document_type = 'timesheet'
      AND COALESCE(NULLIF(p_scope_id, 0), d.project_id) IS NOT NULL
    ORDER BY rc.priority
    LIMIT 1
  ),
  org_manager AS (
    SELECT
      om.employee_id AS assignee_user_id,
      'org_manager'::text AS route_source,
      o.id AS matched_org_id,
      4 + oc.depth AS source_priority,
      0 AS role_priority
    FROM org_chain oc
    JOIN public.organizations o ON o.id = oc.id
    JOIN public.organization_managers om ON om.org_id = o.id
    WHERE p_resolver_type = 'org_manager'
      AND om.is_active = true
      AND om.manager_role = 'department_owner'
    ORDER BY oc.depth, om.is_primary DESC, om.updated_at DESC, om.id DESC
    LIMIT 1
  ),
  creator AS (
    SELECT
      d.creator_user_id AS assignee_user_id,
      'document_creator'::text AS route_source,
      d.creator_org_id AS matched_org_id,
      20 AS source_priority,
      0 AS role_priority
    FROM doc d
    WHERE p_resolver_type = 'document_creator'
  ),
  admin_fallback AS (
    SELECT
      ur.employee_id AS assignee_user_id,
      'admin_fallback'::text AS route_source,
      NULL::bigint AS matched_org_id,
      99 AS source_priority,
      0 AS role_priority
    FROM public.user_roles ur
    WHERE p_allow_admin_fallback = true
      AND ur.role = 'admin'
    ORDER BY ur.employee_id
    LIMIT 1
  ),
  candidates AS (
    SELECT * FROM department_owner_submitter
    UNION ALL SELECT * FROM project_role_match
    UNION ALL SELECT * FROM timesheet_project_owner
    UNION ALL SELECT * FROM org_manager
    UNION ALL SELECT * FROM creator
    UNION ALL SELECT * FROM admin_fallback
  )
  SELECT assignee_user_id, route_source, matched_org_id
  FROM candidates
  WHERE assignee_user_id IS NOT NULL AND assignee_user_id <> 0
  ORDER BY source_priority, role_priority
  LIMIT 1;
$$;

-- Repair running graphs created before the resolver fix. Only source-side
-- nodes are skipped; collaboration projects continue through their PM nodes.
DO $$
DECLARE
  v_instance record;
BEGIN
  FOR v_instance IN
    SELECT DISTINCT
      ai.id AS instance_id,
      ai.current_round_id AS round_id,
      bd.creator_user_id
    FROM public.approval_instances ai
    JOIN public.business_documents bd ON bd.id = ai.document_id
    JOIN public.timesheets t ON t.id = ai.target_id
    JOIN public.employee_profiles ep ON ep.employee_id = bd.creator_user_id
    JOIN public.organizations o ON o.id = ep.org_id AND o.org_code = 'CC'
    JOIN public.organization_managers om
      ON om.org_id = ep.org_id
     AND om.employee_id = bd.creator_user_id
     AND om.manager_role = 'department_owner'
     AND om.is_active = true
    WHERE ai.target_type = 'timesheet'
      AND ai.status = 'running'
      AND t.status = 'submitted'
  LOOP
    UPDATE public.approval_node_assignees a
    SET status = 'skipped',
        action = 'skipped',
        comment = 'Source review bypassed for department-owner submission',
        acted_at = COALESCE(acted_at, now())
    FROM public.approval_nodes n
    WHERE n.id = a.node_id
      AND n.instance_id = v_instance.instance_id
      AND n.template_node_key IN (
        'cc_project_owner',
        'cc_civil_project_owner',
        'cc_mep_project_owner',
        'cc_department_owner'
      )
      AND a.status = 'pending';

    UPDATE public.approval_nodes n
    SET status = 'skipped',
        result_action = 'skipped',
        completed_at = COALESCE(completed_at, now()),
        comment = 'Source review bypassed for department-owner submission',
        assignee_user_id = v_instance.creator_user_id,
        assignee_role = COALESCE(assignee_role, resolver_role),
        snapshot = COALESCE(snapshot, '{}'::jsonb) || jsonb_build_object(
          'resolved_assignee_user_id', v_instance.creator_user_id,
          'route_source', 'department_owner_submitter',
          'auto_skip_reason', 'submitter_is_department_owner'
        ),
        updated_at = now()
    WHERE n.instance_id = v_instance.instance_id
      AND n.template_node_key IN (
        'cc_project_owner',
        'cc_civil_project_owner',
        'cc_mep_project_owner',
        'cc_department_owner'
      )
      AND n.status IN ('waiting', 'pending', 'active', 'needs_reapproval');

    PERFORM public.psa_activate_ready_nodes(v_instance.round_id);
    PERFORM public.psa_finalize_approval_instance_if_complete(
      v_instance.instance_id,
      v_instance.creator_user_id,
      'migration_142_cc_department_owner_submission_routing'
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.psa_resolve_graph_assignees(bigint, text, text, bigint, boolean)
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
