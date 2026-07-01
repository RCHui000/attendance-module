-- Assert that timesheet approvals are routed through the configured
-- PM/CONSULTING/PMCC contract_approval templates, not the legacy timesheet template.
--
-- Usage:
--   docker exec -i approval-postgres psql -U psa_admin -d psa \
--     < scripts/assert-timesheet-template-routing.sql

\pset pager off
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_contract_templates integer;
  v_bad_instances integer;
  v_bad_pending integer;
  v_bad_node_mappings integer;
BEGIN
  SELECT count(*) INTO v_contract_templates
  FROM public.approval_templates
  WHERE document_type = 'contract_approval'
    AND business_type IN ('PM', 'CONSULTING', 'PMCC')
    AND status = 'active';

  IF v_contract_templates <> 3 THEN
    RAISE EXCEPTION 'Expected 3 active contract_approval templates, found %', v_contract_templates;
  END IF;

  SELECT count(*) INTO v_bad_instances
  FROM public.approval_instances i
  JOIN public.timesheets t ON t.id = i.target_id
  LEFT JOIN public.approval_templates tpl ON tpl.id = i.template_id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND (
      tpl.document_type IS DISTINCT FROM 'contract_approval'
      OR tpl.business_type NOT IN ('PM', 'CONSULTING', 'PMCC')
    );

  IF v_bad_instances <> 0 THEN
    RAISE EXCEPTION 'Submitted running timesheet instances not using contract_approval templates: %', v_bad_instances;
  END IF;

  SELECT count(*) INTO v_bad_pending
  FROM public.approval_pending_tasks_view p
  JOIN public.approval_instances i
    ON i.target_type = p.target_type
   AND i.target_id = p.target_id
  LEFT JOIN public.approval_templates tpl ON tpl.id = i.template_id
  WHERE p.target_type = 'timesheet'
    AND (
      tpl.document_type IS DISTINCT FROM 'contract_approval'
      OR tpl.business_type NOT IN ('PM', 'CONSULTING', 'PMCC')
    );

  IF v_bad_pending <> 0 THEN
    RAISE EXCEPTION 'Pending timesheet tasks not using contract_approval templates: %', v_bad_pending;
  END IF;

  SELECT count(*) INTO v_bad_node_mappings
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  JOIN public.timesheets t ON t.id = i.target_id
  LEFT JOIN public.approval_template_nodes tn
    ON tn.template_id = i.template_id
   AND tn.node_key = n.template_node_key
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
    AND n.status <> 'cancelled'
    AND n.node_type = 'approval'
    AND tn.id IS NULL;

  IF v_bad_node_mappings <> 0 THEN
    RAISE EXCEPTION 'Active timesheet approval nodes without matching template node: %', v_bad_node_mappings;
  END IF;
END;
$$;

SELECT
  'PASS' AS result,
  count(*) FILTER (WHERE tpl.business_type = 'PM') AS pm_instances,
  count(*) FILTER (WHERE tpl.business_type = 'CONSULTING') AS consulting_instances,
  count(*) FILTER (WHERE tpl.business_type = 'PMCC') AS pmcc_instances
FROM public.approval_instances i
JOIN public.timesheets t ON t.id = i.target_id
JOIN public.approval_templates tpl ON tpl.id = i.template_id
WHERE i.target_type = 'timesheet'
  AND i.status = 'running'
  AND t.status = 'submitted';
