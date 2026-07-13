-- Keep TEO child departments on their own collaboration routes.
-- A parent_org_code = TEO alias also matched CC submitters and incorrectly
-- routed their source-side approval to Design Consulting project owners.

BEGIN;

UPDATE public.approval_role_aliases
SET is_active = false,
    updated_at = now()
WHERE resolver_type = 'project_role'
  AND (
    (
      document_type = 'timesheet'
      AND org_code IS NULL
      AND parent_org_code = 'TEO'
      AND cost_specialty IS NULL
      AND (
        (requested_role_key = 'cc_project_owner' AND candidate_role_key = 'cc_design_project_owner')
        OR
        (requested_role_key = 'pm_cost_department_owner' AND candidate_role_key = 'pm_design_project_owner')
      )
    )
    OR
    (
      document_type IS NULL
      AND requested_role_key = 'cc_project_owner'
      AND candidate_role_key IN ('cc_civil_project_owner', 'cc_mep_project_owner')
      AND business_type IS NULL
      AND org_code IS NULL
      AND parent_org_code IS NULL
      AND cost_specialty IS NULL
    )
  );

-- Running nodes may have snapshotted the overly broad alias. Clear only that
-- derived route so the existing route refresh resolves from resolver_role.
CREATE TEMP TABLE affected_collaboration_nodes ON COMMIT DROP AS
SELECT n.id AS node_id, i.target_id AS timesheet_id
FROM public.approval_nodes n
JOIN public.approval_instances i ON i.id = n.instance_id
JOIN public.timesheets t ON t.id = i.target_id
LEFT JOIN public.employee_profiles ep ON ep.employee_id = t.user_id
LEFT JOIN public.organizations o ON o.id = ep.org_id
WHERE i.target_type = 'timesheet'
  AND i.status = 'running'
  AND t.status = 'submitted'
  AND n.status IN ('active', 'waiting', 'pending')
  AND n.resolver_type = 'project_role'
  AND (
    (
      n.snapshot ->> 'route_source' IN (
        'project_roles:cc_design_project_owner',
        'project_roles:pm_design_project_owner'
      )
      AND o.org_code IS DISTINCT FROM 'PM_DESIGN'
    )
    OR (
      n.snapshot ->> 'route_source' = 'project_roles:cc_mep_project_owner'
      AND ep.cost_specialty IS DISTINCT FROM 'mep'
    )
    OR (
      n.snapshot ->> 'route_source' = 'project_roles:cc_civil_project_owner'
      AND ep.cost_specialty IS DISTINCT FROM 'civil'
    )
  );

UPDATE public.approval_nodes n
SET snapshot = COALESCE(n.snapshot, '{}'::jsonb)
      - 'route_source'
      - 'resolved_assignee_user_id'
      - 'matched_org_id',
    updated_at = now()
FROM public.approval_instances i
JOIN public.timesheets t ON t.id = i.target_id
JOIN affected_collaboration_nodes affected ON affected.timesheet_id = i.target_id
WHERE n.instance_id = i.id
  AND affected.node_id = n.id
  AND i.target_type = 'timesheet'
  AND i.status = 'running'
  AND t.status = 'submitted'
  AND n.status IN ('active', 'waiting', 'pending')
  AND n.resolver_type = 'project_role'
  AND n.resolver_type = 'project_role';

DO $$
DECLARE
  v_timesheet record;
BEGIN
  FOR v_timesheet IN SELECT DISTINCT timesheet_id FROM affected_collaboration_nodes ORDER BY timesheet_id
  LOOP
    PERFORM public.psa_refresh_running_project_review_routes(
      NULL,
      v_timesheet.timesheet_id,
      'V0.18.39 repair overly broad collaboration role aliases'
    );
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.approval_role_aliases a
    WHERE a.is_active = true
      AND a.document_type = 'timesheet'
      AND a.resolver_type = 'project_role'
      AND a.org_code IS NULL
      AND a.parent_org_code = 'TEO'
      AND a.cost_specialty IS NULL
      AND (
        (a.requested_role_key = 'cc_project_owner' AND a.candidate_role_key = 'cc_design_project_owner')
        OR
        (a.requested_role_key = 'pm_cost_department_owner' AND a.candidate_role_key = 'pm_design_project_owner')
      )
  ) THEN
    RAISE EXCEPTION 'Broad TEO collaboration aliases must be inactive';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.approval_role_aliases a
    WHERE a.is_active = true
      AND a.document_type IS NULL
      AND a.resolver_type = 'project_role'
      AND a.requested_role_key = 'cc_project_owner'
      AND a.candidate_role_key IN ('cc_civil_project_owner', 'cc_mep_project_owner')
      AND a.business_type IS NULL
      AND a.org_code IS NULL
      AND a.parent_org_code IS NULL
      AND a.cost_specialty IS NULL
  ) THEN
    RAISE EXCEPTION 'CC specialty aliases must require an explicit specialty';
  END IF;
END;
$$;

COMMIT;
