BEGIN;

DO $$
DECLARE
  v_document_id bigint;
  v_owner_id bigint;
  v_org_id bigint;
  v_project_id bigint;
  v_regular_employee_id bigint;
  v_resolved_id bigint;
  v_route_source text;
BEGIN
  SELECT e.id, ep.org_id
    INTO v_owner_id, v_org_id
  FROM public.employees e
  JOIN public.employee_profiles ep ON ep.employee_id = e.id
  JOIN public.organizations o ON o.id = ep.org_id AND o.org_code = 'CC'
  JOIN public.organization_managers om
    ON om.org_id = ep.org_id
   AND om.employee_id = e.id
   AND om.manager_role = 'department_owner'
   AND om.is_active = true
  ORDER BY om.is_primary DESC, om.updated_at DESC, om.id DESC
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Missing active CC department owner test fixture';
  END IF;

  SELECT p.id
    INTO v_project_id
  FROM public.projects p
  WHERE p.business_type = 'CONSULTING'
  ORDER BY p.id
  LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Missing CONSULTING project test fixture';
  END IF;

  INSERT INTO public.business_documents (
    document_type,
    business_id,
    business_version,
    creator_user_id,
    creator_employee_id,
    creator_org_id,
    project_id,
    business_type,
    lifecycle_status
  )
  VALUES (
    'timesheet',
    -142,
    1,
    v_owner_id,
    v_owner_id,
    v_org_id,
    v_project_id,
    'CONSULTING',
    'in_approval'
  )
  RETURNING id INTO v_document_id;

  SELECT route.assignee_user_id, route.route_source
    INTO v_resolved_id, v_route_source
  FROM public.psa_resolve_graph_assignees(
    v_document_id,
    'project_role',
    'cc_project_owner',
    v_project_id,
    false
  ) route
  LIMIT 1;

  IF v_resolved_id IS DISTINCT FROM v_owner_id
     OR v_route_source IS DISTINCT FROM 'department_owner_submitter' THEN
    RAISE EXCEPTION
      'CC department-owner submission should self-resolve source project-owner node, got id=% source=%',
      v_resolved_id,
      v_route_source;
  END IF;

  SELECT e.id
    INTO v_regular_employee_id
  FROM public.employees e
  JOIN public.employee_profiles ep ON ep.employee_id = e.id AND ep.org_id = v_org_id
  WHERE e.is_active = true
    AND e.id <> v_owner_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.organization_managers om
      WHERE om.org_id = v_org_id
        AND om.employee_id = e.id
        AND om.manager_role = 'department_owner'
        AND om.is_active = true
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.project_roles pr
      WHERE pr.project_id = v_project_id
        AND pr.employee_id = e.id
        AND pr.status = 'active'
        AND pr.role_key IN (
          'cc_project_owner',
          'cc_civil_project_owner',
          'cc_mep_project_owner'
        )
    )
  ORDER BY e.id
  LIMIT 1;

  IF v_regular_employee_id IS NULL THEN
    RAISE EXCEPTION 'Missing regular CC employee test fixture';
  END IF;

  INSERT INTO public.business_documents (
    document_type,
    business_id,
    business_version,
    creator_user_id,
    creator_employee_id,
    creator_org_id,
    project_id,
    business_type,
    lifecycle_status
  )
  VALUES (
    'timesheet',
    -143,
    1,
    v_regular_employee_id,
    v_regular_employee_id,
    v_org_id,
    v_project_id,
    'CONSULTING',
    'in_approval'
  )
  RETURNING id INTO v_document_id;

  SELECT route.assignee_user_id, route.route_source
    INTO v_resolved_id, v_route_source
  FROM public.psa_resolve_graph_assignees(
    v_document_id,
    'project_role',
    'cc_project_owner',
    v_project_id,
    false
  ) route
  LIMIT 1;

  IF v_resolved_id IS NULL
     OR v_resolved_id = v_regular_employee_id
     OR v_route_source = 'department_owner_submitter' THEN
    RAISE EXCEPTION
      'Regular CC submission must keep its configured project-owner route, got id=% source=%',
      v_resolved_id,
      v_route_source;
  END IF;

  RAISE NOTICE 'CC department-owner submission routing assertion passed';
END;
$$;

ROLLBACK;
