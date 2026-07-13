DO $$
DECLARE
  v_bad_edges integer;
  v_bad_department_resolver integer;
  v_broad_teo_aliases integer;
  v_unscoped_specialty_aliases integer;
  v_doc_id bigint;
  v_assignee bigint;
  v_route_source text;
BEGIN
  WITH expected(from_node_key, to_node_key) AS (
    VALUES
      ('cc_submitter', 'cc_project_owner'),
      ('cc_project_owner', 'cc_department_owner'),
      ('cc_department_owner', 'pm_cost_department_owner'),
      ('pm_cost_department_owner', 'pm_project_owner'),
      ('pm_project_owner', 'pm_department_owner')
  ),
  actual AS (
    SELECT e.from_node_key, e.to_node_key
    FROM public.approval_template_edges e
    JOIN public.approval_templates t ON t.id = e.template_id
    WHERE t.template_key = 'contract_approval_pmcc_v1'
      AND e.edge_type = 'normal'
  ),
  diff AS (
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    UNION ALL
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
  )
  SELECT count(*) INTO v_bad_edges
  FROM diff;

  IF v_bad_edges <> 0 THEN
    RAISE EXCEPTION 'Collaboration template edge set is not the expected source-side then PM-side chain';
  END IF;

  SELECT count(*) INTO v_bad_department_resolver
  FROM public.approval_template_nodes n
  JOIN public.approval_templates t ON t.id = n.template_id
  WHERE t.template_key = 'contract_approval_pmcc_v1'
    AND n.node_key = 'cc_department_owner'
    AND (
      n.node_name <> '发起部门负责人'
      OR n.resolver_type <> 'org_manager'
      OR n.resolver_role <> 'department_owner'
    );

  IF v_bad_department_resolver <> 0 THEN
    RAISE EXCEPTION 'Collaboration source department owner must use org_manager/department_owner';
  END IF;

  SELECT count(*) INTO v_broad_teo_aliases
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
    );

  IF v_broad_teo_aliases <> 0 THEN
    RAISE EXCEPTION 'Broad TEO aliases must not override child department collaboration routes';
  END IF;

  SELECT count(*) INTO v_unscoped_specialty_aliases
  FROM public.approval_role_aliases a
  WHERE a.is_active = true
    AND a.document_type IS NULL
    AND a.resolver_type = 'project_role'
    AND a.requested_role_key = 'cc_project_owner'
    AND a.candidate_role_key IN ('cc_civil_project_owner', 'cc_mep_project_owner')
    AND a.business_type IS NULL
    AND a.org_code IS NULL
    AND a.parent_org_code IS NULL
    AND a.cost_specialty IS NULL;

  IF v_unscoped_specialty_aliases <> 0 THEN
    RAISE EXCEPTION 'CC specialty aliases must require an explicit specialty';
  END IF;

  SELECT bd.id INTO v_doc_id
  FROM public.business_documents bd
  JOIN public.timesheets t ON t.id = bd.business_id
  JOIN public.hr_employee_current_view h ON h.employee_id = t.user_id
  JOIN public.timesheet_entries te ON te.timesheet_id = t.id
  JOIN public.projects p ON p.id = te.project_id
  JOIN public.project_roles pr ON pr.project_id = p.id
   AND pr.status = 'active'
   AND pr.role_key = 'cc_mep_project_owner'
   AND pr.employee_id = t.user_id
  WHERE bd.document_type = 'timesheet'
    AND h.cost_specialty = 'mep'
  ORDER BY t.id DESC
  LIMIT 1;

  IF v_doc_id IS NOT NULL THEN
    SELECT assignee_user_id, route_source
      INTO v_assignee, v_route_source
    FROM public.psa_resolve_graph_assignees(
      v_doc_id,
      'project_role',
      'cc_project_owner',
      (
        SELECT te.project_id
        FROM public.business_documents bd
        JOIN public.timesheet_entries te ON te.timesheet_id = bd.business_id
        JOIN public.project_roles pr ON pr.project_id = te.project_id
         AND pr.status = 'active'
         AND pr.role_key = 'cc_mep_project_owner'
         AND pr.employee_id = bd.creator_user_id
        WHERE bd.id = v_doc_id
        LIMIT 1
      ),
      false
    )
    LIMIT 1;

    IF COALESCE(v_route_source, '') <> 'project_roles:cc_mep_project_owner' THEN
      RAISE EXCEPTION 'Expected mep submitter project-owner alias to resolve to cc_mep_project_owner, got %', v_route_source;
    END IF;
  END IF;
END $$;
