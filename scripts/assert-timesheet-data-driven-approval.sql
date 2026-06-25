-- Assert the data-driven timesheet approval engine configuration.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-timesheet-data-driven-approval.sql

\set ON_ERROR_STOP on
\pset pager off
\pset format aligned
SET client_min_messages TO warning;

DO $$
DECLARE
  v_missing_tables text[];
  v_disabled_settings text[];
  v_bad_template_nodes int;
  v_missing_routes int;
  v_missing_aliases int;
  v_duplicate_edges int;
  v_bad_running_instances int;
  v_normal_special_nodes int;
BEGIN
  SELECT ARRAY(
    SELECT table_name
    FROM unnest(ARRAY[
      'approval_business_type_source_rules',
      'approval_business_type_merge_rules',
      'approval_template_routing_rules',
      'approval_role_aliases',
      'approval_engine_settings'
    ]) AS expected(table_name)
    WHERE to_regclass('public.' || expected.table_name) IS NULL
    ORDER BY table_name
  ) INTO v_missing_tables;

  IF cardinality(v_missing_tables) > 0 THEN
    RAISE EXCEPTION 'Missing data-driven approval tables: %', array_to_string(v_missing_tables, ', ');
  END IF;

  SELECT ARRAY(
    SELECT expected.setting_key
    FROM unnest(ARRAY[
      'data_driven_business_type_enabled',
      'data_driven_template_routing_enabled',
      'data_driven_node_expansion_enabled',
      'data_driven_role_aliases_enabled',
      'data_driven_missing_assignee_policy_enabled'
    ]) AS expected(setting_key)
    LEFT JOIN public.approval_engine_settings s ON s.setting_key = expected.setting_key
    WHERE COALESCE((s.setting_value ->> 'enabled')::boolean, false) IS DISTINCT FROM true
    ORDER BY expected.setting_key
  ) INTO v_disabled_settings;

  IF cardinality(v_disabled_settings) > 0 THEN
    RAISE EXCEPTION 'Data-driven approval settings are not enabled: %', array_to_string(v_disabled_settings, ', ');
  END IF;

  SELECT count(*) INTO v_missing_routes
  FROM (VALUES
    ('timesheet', 'PM', 'contract_approval_pm_v1'),
    ('timesheet', 'CC', 'contract_approval_cc_v1'),
    ('timesheet', 'PMCC', 'contract_approval_pmcc_v1'),
    ('timesheet', 'LEAVE', 'timesheet_special_department_owner_v1')
  ) AS expected(source_document_type, business_type, template_key)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.approval_template_routing_rules r
    WHERE r.source_document_type = expected.source_document_type
      AND r.business_type = expected.business_type
      AND r.template_key = expected.template_key
      AND r.is_active = true
  );

  IF v_missing_routes <> 0 THEN
    RAISE EXCEPTION 'Missing active timesheet template routing rules: %', v_missing_routes;
  END IF;

  SELECT count(*) INTO v_missing_aliases
  FROM (VALUES
    ('cc_project_owner', 'cc_project_owner'),
    ('cc_project_owner', 'cc_mep_project_owner'),
    ('cc_project_owner', 'cc_civil_project_owner'),
    ('pm_project_owner', 'pm_project_owner'),
    ('pm_department_owner', 'pm_department_owner'),
    ('cc_department_owner', 'cc_department_owner'),
    ('pm_cost_department_owner', 'pm_cost_department_owner')
  ) AS expected(requested_role_key, candidate_role_key)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.approval_role_aliases a
    WHERE a.resolver_type = 'project_role'
      AND a.requested_role_key = expected.requested_role_key
      AND a.candidate_role_key = expected.candidate_role_key
      AND a.is_active = true
  );

  IF v_missing_aliases <> 0 THEN
    RAISE EXCEPTION 'Missing active approval role aliases: %', v_missing_aliases;
  END IF;

  SELECT count(*) INTO v_normal_special_nodes
  FROM public.approval_template_nodes n
  JOIN public.approval_templates t ON t.id = n.template_id
  WHERE t.template_key IN (
      'contract_approval_pm_v1',
      'contract_approval_cc_v1',
      'contract_approval_pmcc_v1'
    )
    AND n.node_key = 'special_department_owner';

  IF v_normal_special_nodes <> 0 THEN
    RAISE EXCEPTION 'Normal approval templates must not contain special_department_owner nodes: %', v_normal_special_nodes;
  END IF;

  SELECT count(*) INTO v_bad_template_nodes
  FROM public.approval_template_nodes n
  JOIN public.approval_templates t ON t.id = n.template_id
  WHERE t.template_key IN (
      'contract_approval_pm_v1',
      'contract_approval_cc_v1',
      'contract_approval_pmcc_v1'
    )
    AND (
      (
        (n.resolver_type = 'document_creator' OR COALESCE(n.resolver_role, '') = 'submitter')
        AND (
          n.scope_strategy <> 'submitter_virtual'
          OR n.missing_assignee_policy <> 'required'
        )
      )
      OR (
        n.resolver_type <> 'document_creator'
        AND COALESCE(n.resolver_role, '') <> 'submitter'
        AND (
          n.scope_strategy <> 'per_project'
          OR n.scope_source <> 'timesheet_projects'
          OR n.runtime_scope_type <> 'project'
          OR n.runtime_node_key_template <> 'project_{scope_id}_{node_key}'
          OR n.missing_assignee_policy <> 'skip'
        )
      )
    );

  IF v_bad_template_nodes <> 0 THEN
    RAISE EXCEPTION 'Contract approval template nodes missing data-driven runtime policy: %', v_bad_template_nodes;
  END IF;

  SELECT count(*) INTO v_duplicate_edges
  FROM (
    SELECT template_id, from_node_key, to_node_key, edge_type
    FROM public.approval_template_edges
    GROUP BY template_id, from_node_key, to_node_key, edge_type
    HAVING count(*) > 1
  ) duplicates;

  IF v_duplicate_edges <> 0 THEN
    RAISE EXCEPTION 'Duplicate approval template edge paths remain: %', v_duplicate_edges;
  END IF;

  SELECT count(*) INTO v_bad_running_instances
  FROM public.approval_instances i
  JOIN public.timesheets t ON t.id = i.target_id
  JOIN public.approval_templates current_tpl ON current_tpl.id = i.template_id
  JOIN LATERAL public.psa_select_approval_template('timesheet', i.target_id, NULL, '{}'::jsonb) selected_tpl ON true
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND selected_tpl.template_key IS DISTINCT FROM current_tpl.template_key;

  IF v_bad_running_instances <> 0 THEN
    RAISE NOTICE 'Running submitted timesheets disagree with current template selection and keep their historical graph: %', v_bad_running_instances;
  END IF;
END $$;

SELECT 'PASS: timesheet approval engine is data-driven for routing, expansion policy, role aliases, and missing-assignee policy' AS result;
