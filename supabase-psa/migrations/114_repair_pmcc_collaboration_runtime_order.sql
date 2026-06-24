BEGIN;

WITH desired(node_key, sort_order) AS (
  VALUES
    ('cc_project_owner', 20),
    ('cc_department_owner', 30),
    ('pm_cost_department_owner', 40),
    ('pm_project_owner', 50),
    ('pm_department_owner', 60)
)
UPDATE public.approval_template_nodes tn
SET sort_order = desired.sort_order
FROM public.approval_templates t, desired
WHERE tn.template_id = t.id
  AND t.template_key = 'contract_approval_pmcc_v1'
  AND tn.node_key = desired.node_key
  AND tn.sort_order IS DISTINCT FROM desired.sort_order;

WITH desired(role_key, sort_order) AS (
  VALUES
    ('cc_civil_project_owner', 10),
    ('cc_mep_project_owner', 20),
    ('cc_design_project_owner', 25),
    ('cc_department_owner', 30),
    ('pm_cost_department_owner', 40),
    ('pm_design_project_owner', 45),
    ('pm_project_owner', 50),
    ('pm_department_owner', 60)
)
UPDATE public.project_role_requirements r
SET sort_order = desired.sort_order,
    updated_at = now()
FROM desired
WHERE r.business_type = 'PMCC'
  AND r.role_key = desired.role_key
  AND r.sort_order IS DISTINCT FROM desired.sort_order;

DELETE FROM public.approval_template_edges e
USING public.approval_templates t
WHERE e.template_id = t.id
  AND t.template_key = 'contract_approval_pmcc_v1'
  AND e.from_node_key IN (
    'cc_project_owner',
    'cc_department_owner',
    'pm_cost_department_owner',
    'pm_project_owner',
    'pm_department_owner'
  )
  AND e.to_node_key IN (
    'cc_project_owner',
    'cc_department_owner',
    'pm_cost_department_owner',
    'pm_project_owner',
    'pm_department_owner'
  );

WITH template AS (
  SELECT id
  FROM public.approval_templates
  WHERE template_key = 'contract_approval_pmcc_v1'
),
edges(from_node_key, to_node_key) AS (
  VALUES
    ('cc_project_owner', 'cc_department_owner'),
    ('cc_department_owner', 'pm_cost_department_owner'),
    ('pm_cost_department_owner', 'pm_project_owner'),
    ('pm_project_owner', 'pm_department_owner')
)
INSERT INTO public.approval_template_edges (
  template_id, from_node_key, to_node_key, edge_type, condition_expr, scope_join_policy
)
SELECT template.id, edges.from_node_key, edges.to_node_key, 'normal', '{}'::jsonb, 'same_scope'
FROM template
CROSS JOIN edges
ON CONFLICT (template_id, from_node_key, to_node_key, edge_type)
DO UPDATE
SET condition_expr = EXCLUDED.condition_expr,
    scope_join_policy = EXCLUDED.scope_join_policy;

WITH running_pmcc_instances AS (
  SELECT DISTINCT i.id AS instance_id, ar.id AS round_id
  FROM public.approval_instances i
  JOIN public.approval_rounds ar ON ar.instance_id = i.id
  JOIN public.approval_nodes n ON n.instance_id = i.id
  JOIN public.projects p ON p.id = n.scope_id AND n.scope_type = 'project'
  WHERE i.status = 'running'
    AND i.target_type = 'timesheet'
    AND p.business_type = 'PMCC'
),
pmcc_keys(node_key) AS (
  VALUES
    ('cc_project_owner'),
    ('cc_department_owner'),
    ('pm_cost_department_owner'),
    ('pm_project_owner'),
    ('pm_department_owner')
),
deleted AS (
  DELETE FROM public.approval_edges e
  USING running_pmcc_instances r,
        public.approval_nodes from_node,
        public.approval_nodes to_node,
        pmcc_keys from_key,
        pmcc_keys to_key
  WHERE e.instance_id = r.instance_id
    AND from_node.id = e.from_node_id
    AND to_node.id = e.to_node_id
    AND from_node.instance_id = r.instance_id
    AND to_node.instance_id = r.instance_id
    AND from_node.template_node_key = from_key.node_key
    AND to_node.template_node_key = to_key.node_key
    AND from_node.scope_type = 'project'
    AND to_node.scope_type = 'project'
    AND from_node.scope_id IS NOT DISTINCT FROM to_node.scope_id
  RETURNING e.id
),
desired_edges(from_key, to_key) AS (
  VALUES
    ('cc_project_owner', 'cc_department_owner'),
    ('cc_department_owner', 'pm_cost_department_owner'),
    ('pm_cost_department_owner', 'pm_project_owner'),
    ('pm_project_owner', 'pm_department_owner')
)
INSERT INTO public.approval_edges (
  round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type, condition_expr, condition_result
)
SELECT
  r.round_id,
  r.instance_id,
  from_node.id,
  to_node.id,
  'normal',
  'normal',
  '{}'::jsonb,
  true
FROM running_pmcc_instances r
CROSS JOIN desired_edges d
JOIN public.approval_nodes from_node
  ON from_node.instance_id = r.instance_id
 AND from_node.template_node_key = d.from_key
 AND from_node.scope_type = 'project'
JOIN public.approval_nodes to_node
  ON to_node.instance_id = r.instance_id
 AND to_node.template_node_key = d.to_key
 AND to_node.scope_type = 'project'
 AND to_node.scope_id IS NOT DISTINCT FROM from_node.scope_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.approval_edges existing
  WHERE existing.from_node_id = from_node.id
    AND existing.to_node_id = to_node.id
);

NOTIFY pgrst, 'reload schema';

COMMIT;
