-- Assert approval template self-service configuration invariants.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-approval-template-visual-config.sql

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DO $$
DECLARE
  v_normal_special_nodes int;
  v_missing_leave_template int;
BEGIN
  SELECT count(*) INTO v_normal_special_nodes
  FROM public.approval_templates t
  JOIN public.approval_template_nodes n ON n.template_id = t.id
  WHERE t.template_key IN (
      'contract_approval_pm_v1',
      'contract_approval_cc_v1',
      'contract_approval_pmcc_v1'
    )
    AND n.node_key = 'special_department_owner';

  IF v_normal_special_nodes <> 0 THEN
    RAISE EXCEPTION 'Normal approval templates must not contain special_department_owner nodes, found %', v_normal_special_nodes;
  END IF;

  SELECT count(*) INTO v_missing_leave_template
  FROM public.approval_template_routing_rules r
  JOIN public.approval_templates t ON t.template_key = r.template_key
  JOIN public.approval_template_nodes n ON n.template_id = t.id
  WHERE r.source_document_type = 'timesheet'
    AND r.business_type = 'LEAVE'
    AND r.template_key = 'timesheet_special_department_owner_v1'
    AND r.is_active = true
    AND n.node_key = 'special_department_owner'
    AND n.resolver_type = 'org_manager'
    AND n.resolver_role = 'department_owner';

  IF v_missing_leave_template = 0 THEN
    RAISE EXCEPTION 'LEAVE route must point to the independent department-owner template';
  END IF;
END $$;

DROP TABLE IF EXISTS pg_temp.visual_config_admin;
CREATE TEMP TABLE visual_config_admin AS
SELECT e.auth_user_id
FROM public.employees e
JOIN public.user_roles ur ON ur.employee_id = e.id
WHERE ur.role = 'admin'
  AND e.auth_user_id IS NOT NULL
ORDER BY e.id
LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_temp.visual_config_admin) <> 1 THEN
    RAISE EXCEPTION 'No admin auth user available for approval config save smoke';
  END IF;
END $$;

BEGIN;

SELECT
  set_config('request.jwt.claim.sub', auth_user_id::text, true),
  set_config('request.jwt.claim.role', 'authenticated', true),
  set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', auth_user_id::text, 'role', 'authenticated')::text,
    true
  )
FROM pg_temp.visual_config_admin;

DO $$
DECLARE
  v_template_id bigint;
  v_template record;
  v_nodes jsonb;
  v_extra_key text := 'approval_config_smoke_extra';
  v_previous_key text;
  v_extra_id bigint;
BEGIN
  SELECT *
    INTO v_template
  FROM public.approval_templates
  WHERE template_key = 'contract_approval_pm_v1'
  LIMIT 1;

  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'contract_approval_pm_v1 template is missing';
  END IF;

  v_template_id := v_template.id;

  SELECT n.node_key
    INTO v_previous_key
  FROM public.approval_template_nodes n
  WHERE n.template_id = v_template_id
  ORDER BY n.sort_order DESC, n.id DESC
  LIMIT 1;

  SELECT jsonb_agg(to_jsonb(n) ORDER BY n.sort_order, n.id)
    INTO v_nodes
  FROM public.approval_template_nodes n
  WHERE n.template_id = v_template_id;

  v_nodes := COALESCE(v_nodes, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'node_key', v_extra_key,
      'node_name', '配置保存冒烟节点',
      'node_type', 'approval',
      'resolver_type', 'org_manager',
      'resolver_role', 'department_owner',
      'approval_policy', 'single',
      'reject_policy', 'back_to_creator',
      'allow_delegate', false,
      'allow_skip', false,
      'sort_order', 999,
      'scope_strategy', 'per_project',
      'scope_source', 'timesheet_projects',
      'runtime_scope_type', 'project',
      'runtime_node_key_template', 'project_{scope_id}_{node_key}',
      'missing_assignee_policy', 'skip'
    )
  );

  PERFORM public.psa_save_approval_template(
    v_template_id,
    v_template.name,
    v_template.status,
    v_template.version,
    v_nodes
  );

  SELECT id INTO v_extra_id
  FROM public.approval_template_nodes
  WHERE template_id = v_template_id
    AND node_key = v_extra_key;

  IF v_extra_id IS NULL THEN
    RAISE EXCEPTION 'psa_save_approval_template did not insert a new node from the payload';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.approval_template_edges e
    WHERE e.template_id = v_template_id
      AND e.from_node_key = v_previous_key
      AND e.to_node_key = v_extra_key
  ) THEN
    RAISE EXCEPTION 'psa_save_approval_template did not rebuild sequential edges for the inserted node';
  END IF;
END $$;

ROLLBACK;

SELECT 'PASS: approval template visual configuration invariants hold' AS result;
