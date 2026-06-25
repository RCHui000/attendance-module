-- Assert that leave is modeled as non-project work while still using timesheet project rows.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-leave-non-project-work-kind.sql

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DO $$
DECLARE
  v_leave_project_id bigint;
  v_active_leave_projects int;
  v_bad_leave_refs int;
  v_missing_route int;
  v_bad_special_node int;
  v_non_leave_project_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'work_kind'
  ) THEN
    RAISE EXCEPTION 'projects.work_kind is missing';
  END IF;

  SELECT id INTO v_leave_project_id
  FROM public.projects
  WHERE code = 'LEAVE'
    AND name = '请假'
    AND work_kind = 'leave'
    AND COALESCE(status, 'active') = 'active'
  LIMIT 1;

  IF v_leave_project_id IS NULL THEN
    RAISE EXCEPTION 'Active LEAVE / 请假 project with work_kind=leave is missing';
  END IF;

  SELECT count(*) INTO v_active_leave_projects
  FROM public.projects
  WHERE work_kind = 'leave'
    AND COALESCE(status, 'active') = 'active';

  IF v_active_leave_projects <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one active leave project, found %', v_active_leave_projects;
  END IF;

  SELECT count(*) INTO v_bad_leave_refs
  FROM public.timesheet_entries te
  JOIN public.projects p ON p.id = te.project_id
  WHERE p.id <> v_leave_project_id
    AND (
      p.work_kind = 'leave'
      OR btrim(p.code) IN ('LEAVE', '请假')
      OR btrim(p.name) = '请假'
    );

  IF v_bad_leave_refs <> 0 THEN
    RAISE EXCEPTION 'Found % timesheet entries still pointing at non-canonical leave projects', v_bad_leave_refs;
  END IF;

  IF public.psa_is_timesheet_special_project(v_leave_project_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'psa_is_timesheet_special_project does not identify LEAVE as special';
  END IF;

  SELECT id INTO v_non_leave_project_id
  FROM public.projects
  WHERE COALESCE(work_kind, 'project') <> 'leave'
    AND COALESCE(status, 'active') <> 'deleted'
  LIMIT 1;

  IF v_non_leave_project_id IS NOT NULL
     AND public.psa_is_timesheet_special_project(v_non_leave_project_id) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'psa_is_timesheet_special_project misidentifies a normal project as special';
  END IF;

  SELECT count(*) INTO v_missing_route
  FROM public.approval_template_routing_rules r
  WHERE r.source_document_type = 'timesheet'
    AND r.business_type = 'LEAVE'
    AND r.template_key = 'timesheet_special_department_owner_v1'
    AND r.is_active = true;

  IF v_missing_route = 0 THEN
    RAISE EXCEPTION 'Missing LEAVE route to timesheet_special_department_owner_v1';
  END IF;

  SELECT count(*) INTO v_bad_special_node
  FROM public.approval_templates t
  JOIN public.approval_template_nodes n ON n.template_id = t.id
  WHERE t.template_key = 'timesheet_special_department_owner_v1'
    AND n.node_key = 'special_department_owner'
    AND n.resolver_type = 'org_manager'
    AND n.resolver_role = 'department_owner'
    AND n.scope_strategy = 'per_project'
    AND n.scope_source = 'timesheet_projects'
    AND n.runtime_scope_type = 'project'
    AND n.missing_assignee_policy = 'required';

  IF v_bad_special_node = 0 THEN
    RAISE EXCEPTION 'Leave department-owner node is missing or misconfigured';
  END IF;
END $$;

SELECT 'PASS: leave is modeled as non-project timesheet work' AS result;
