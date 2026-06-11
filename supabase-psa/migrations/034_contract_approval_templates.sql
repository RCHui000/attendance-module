-- V0.14.1: Contract approval templates for PM / CC / PMCC routes.
-- The PMCC route is intentionally role-driven because it crosses departments:
-- CC submitter -> CC project owner -> PM cost department owner ->
-- PM project owner -> PM department owner.

BEGIN;

WITH templates(template_key, document_type, business_type, name) AS (
  VALUES
    ('contract_pm_v1', 'contract', 'PM', 'PM Contract Approval'),
    ('contract_cc_v1', 'contract', 'CC', 'CC Contract Approval'),
    ('contract_pmcc_v1', 'contract', 'PMCC', 'PMCC Contract Approval'),
    ('contract_approval_pm_v1', 'contract_approval', 'PM', 'PM Contract Approval'),
    ('contract_approval_cc_v1', 'contract_approval', 'CC', 'CC Contract Approval'),
    ('contract_approval_pmcc_v1', 'contract_approval', 'PMCC', 'PMCC Contract Approval')
)
INSERT INTO public.approval_templates(template_key, document_type, business_type, name, version, status)
SELECT template_key, document_type, business_type, name, 1, 'active'
FROM templates
ON CONFLICT (template_key) DO UPDATE
SET document_type = EXCLUDED.document_type,
    business_type = EXCLUDED.business_type,
    name = EXCLUDED.name,
    version = EXCLUDED.version,
    status = EXCLUDED.status;

WITH pm_templates AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key IN ('contract_pm_v1', 'contract_approval_pm_v1')
),
nodes AS (
  SELECT *
  FROM (VALUES
    ('submitter', 'PM Employee Submitter', 'document_creator', 'submitter', 10),
    ('pm_project_owner', 'PM Project Owner', 'project_role', 'pm_project_owner', 20),
    ('pm_department_owner', 'PM Department Owner', 'project_role', 'pm_department_owner', 30)
  ) AS v(node_key, node_name, resolver_type, resolver_role, sort_order)
)
INSERT INTO public.approval_template_nodes(
  template_id, node_key, node_name, node_type, resolver_type, resolver_role,
  approval_policy, reject_policy, sort_order
)
SELECT t.id, n.node_key, n.node_name, 'approval', n.resolver_type, n.resolver_role,
       'single', 'back_to_creator', n.sort_order
FROM pm_templates t
CROSS JOIN nodes n
ON CONFLICT (template_id, node_key) DO UPDATE
SET node_name = EXCLUDED.node_name,
    resolver_type = EXCLUDED.resolver_type,
    resolver_role = EXCLUDED.resolver_role,
    sort_order = EXCLUDED.sort_order;

WITH cc_templates AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key IN ('contract_cc_v1', 'contract_approval_cc_v1')
),
nodes AS (
  SELECT *
  FROM (VALUES
    ('submitter', 'CC Employee Submitter', 'document_creator', 'submitter', 10),
    ('cc_project_owner', 'CC Project Owner', 'project_role', 'cc_project_owner', 20),
    ('cc_department_owner', 'CC Department Owner', 'project_role', 'cc_department_owner', 30)
  ) AS v(node_key, node_name, resolver_type, resolver_role, sort_order)
)
INSERT INTO public.approval_template_nodes(
  template_id, node_key, node_name, node_type, resolver_type, resolver_role,
  approval_policy, reject_policy, sort_order
)
SELECT t.id, n.node_key, n.node_name, 'approval', n.resolver_type, n.resolver_role,
       'single', 'back_to_creator', n.sort_order
FROM cc_templates t
CROSS JOIN nodes n
ON CONFLICT (template_id, node_key) DO UPDATE
SET node_name = EXCLUDED.node_name,
    resolver_type = EXCLUDED.resolver_type,
    resolver_role = EXCLUDED.resolver_role,
    sort_order = EXCLUDED.sort_order;

WITH pmcc_templates AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key IN ('contract_pmcc_v1', 'contract_approval_pmcc_v1')
),
nodes AS (
  SELECT *
  FROM (VALUES
    ('cc_submitter', 'CC Employee Submitter', 'document_creator', 'submitter', 10),
    ('cc_project_owner', 'CC Project Owner', 'project_role', 'cc_project_owner', 20),
    ('pm_cost_department_owner', 'PM Cost Department Owner', 'project_role', 'pm_cost_department_owner', 30),
    ('pm_project_owner', 'PM Project Owner', 'project_role', 'pm_project_owner', 40),
    ('pm_department_owner', 'PM Department Owner', 'project_role', 'pm_department_owner', 50)
  ) AS v(node_key, node_name, resolver_type, resolver_role, sort_order)
)
INSERT INTO public.approval_template_nodes(
  template_id, node_key, node_name, node_type, resolver_type, resolver_role,
  approval_policy, reject_policy, sort_order
)
SELECT t.id, n.node_key, n.node_name, 'approval', n.resolver_type, n.resolver_role,
       'single', 'back_to_creator', n.sort_order
FROM pmcc_templates t
CROSS JOIN nodes n
ON CONFLICT (template_id, node_key) DO UPDATE
SET node_name = EXCLUDED.node_name,
    resolver_type = EXCLUDED.resolver_type,
    resolver_role = EXCLUDED.resolver_role,
    sort_order = EXCLUDED.sort_order;

DELETE FROM public.approval_template_edges
WHERE template_id IN (
  SELECT id
  FROM public.approval_templates
  WHERE template_key IN (
    'contract_pm_v1', 'contract_cc_v1', 'contract_pmcc_v1',
    'contract_approval_pm_v1', 'contract_approval_cc_v1', 'contract_approval_pmcc_v1'
  )
);

WITH linear_edges(template_key, from_node_key, to_node_key) AS (
  VALUES
    ('contract_pm_v1', 'submitter', 'pm_project_owner'),
    ('contract_pm_v1', 'pm_project_owner', 'pm_department_owner'),
    ('contract_approval_pm_v1', 'submitter', 'pm_project_owner'),
    ('contract_approval_pm_v1', 'pm_project_owner', 'pm_department_owner'),
    ('contract_cc_v1', 'submitter', 'cc_project_owner'),
    ('contract_cc_v1', 'cc_project_owner', 'cc_department_owner'),
    ('contract_approval_cc_v1', 'submitter', 'cc_project_owner'),
    ('contract_approval_cc_v1', 'cc_project_owner', 'cc_department_owner'),
    ('contract_pmcc_v1', 'cc_submitter', 'cc_project_owner'),
    ('contract_pmcc_v1', 'cc_project_owner', 'pm_cost_department_owner'),
    ('contract_pmcc_v1', 'pm_cost_department_owner', 'pm_project_owner'),
    ('contract_pmcc_v1', 'pm_project_owner', 'pm_department_owner'),
    ('contract_approval_pmcc_v1', 'cc_submitter', 'cc_project_owner'),
    ('contract_approval_pmcc_v1', 'cc_project_owner', 'pm_cost_department_owner'),
    ('contract_approval_pmcc_v1', 'pm_cost_department_owner', 'pm_project_owner'),
    ('contract_approval_pmcc_v1', 'pm_project_owner', 'pm_department_owner')
)
INSERT INTO public.approval_template_edges(template_id, from_node_key, to_node_key, edge_type, condition_expr)
SELECT t.id, e.from_node_key, e.to_node_key, 'normal', '{}'::jsonb
FROM linear_edges e
JOIN public.approval_templates t ON t.template_key = e.template_key;

NOTIFY pgrst, 'reload schema';

COMMIT;
