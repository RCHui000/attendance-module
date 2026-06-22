-- V0.18: move timesheet approval routing, expansion, role aliases, and optional
-- assignee policy into data-driven approval template configuration.

BEGIN;

CREATE TABLE IF NOT EXISTS public.approval_business_type_source_rules (
  id bigserial PRIMARY KEY,
  document_type text NOT NULL,
  source_scope text NOT NULL DEFAULT 'project',
  match_field text NOT NULL,
  match_value text NOT NULL,
  result_business_type text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_business_type_merge_rules (
  id bigserial PRIMARY KEY,
  document_type text NOT NULL,
  match_mode text NOT NULL,
  input_business_types text[] NOT NULL,
  result_business_type text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_template_routing_rules (
  id bigserial PRIMARY KEY,
  source_document_type text NOT NULL,
  target_document_type text NOT NULL,
  business_type text,
  template_key text,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_role_aliases (
  id bigserial PRIMARY KEY,
  document_type text,
  resolver_type text NOT NULL DEFAULT 'project_role',
  requested_role_key text NOT NULL,
  candidate_role_key text NOT NULL,
  business_type text,
  org_code text,
  parent_org_code text,
  cost_specialty text,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_engine_settings (
  setting_key text PRIMARY KEY,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_business_type_source_rules
  DROP CONSTRAINT IF EXISTS chk_approval_business_type_source_rules_scope;
ALTER TABLE public.approval_business_type_source_rules
  ADD CONSTRAINT chk_approval_business_type_source_rules_scope
  CHECK (source_scope IN ('project', 'document_context'));

ALTER TABLE public.approval_business_type_source_rules
  DROP CONSTRAINT IF EXISTS chk_approval_business_type_source_rules_match_field;
ALTER TABLE public.approval_business_type_source_rules
  ADD CONSTRAINT chk_approval_business_type_source_rules_match_field
  CHECK (match_field IN ('project_business_type', 'project_code_prefix', 'context_business_type'));

ALTER TABLE public.approval_business_type_merge_rules
  DROP CONSTRAINT IF EXISTS chk_approval_business_type_merge_rules_mode;
ALTER TABLE public.approval_business_type_merge_rules
  ADD CONSTRAINT chk_approval_business_type_merge_rules_mode
  CHECK (match_mode IN ('any', 'exact_set'));

ALTER TABLE public.approval_template_nodes
  ADD COLUMN IF NOT EXISTS scope_strategy text NOT NULL DEFAULT 'once_per_document',
  ADD COLUMN IF NOT EXISTS scope_source text NOT NULL DEFAULT 'document',
  ADD COLUMN IF NOT EXISTS runtime_scope_type text,
  ADD COLUMN IF NOT EXISTS runtime_node_key_template text NOT NULL DEFAULT '{node_key}',
  ADD COLUMN IF NOT EXISTS missing_assignee_policy text NOT NULL DEFAULT 'required';

ALTER TABLE public.approval_template_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_template_nodes_scope_strategy;
ALTER TABLE public.approval_template_nodes
  ADD CONSTRAINT chk_approval_template_nodes_scope_strategy
  CHECK (scope_strategy IN ('once_per_document', 'per_project', 'submitter_virtual'));

ALTER TABLE public.approval_template_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_template_nodes_scope_source;
ALTER TABLE public.approval_template_nodes
  ADD CONSTRAINT chk_approval_template_nodes_scope_source
  CHECK (scope_source IN ('document', 'timesheet_projects', 'context_project'));

ALTER TABLE public.approval_template_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_template_nodes_missing_policy;
ALTER TABLE public.approval_template_nodes
  ADD CONSTRAINT chk_approval_template_nodes_missing_policy
  CHECK (missing_assignee_policy IN ('required', 'skip', 'admin_fallback', 'auto_approve'));

ALTER TABLE public.approval_template_edges
  ADD COLUMN IF NOT EXISTS scope_join_policy text NOT NULL DEFAULT 'same_scope';

ALTER TABLE public.approval_template_edges
  DROP CONSTRAINT IF EXISTS chk_approval_template_edges_scope_join_policy;
ALTER TABLE public.approval_template_edges
  ADD CONSTRAINT chk_approval_template_edges_scope_join_policy
  CHECK (scope_join_policy IN ('same_scope', 'document_to_each_scope', 'each_scope_to_document'));

WITH duplicate_edges AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY template_id, from_node_key, to_node_key, edge_type
      ORDER BY id
    ) AS duplicate_rank
  FROM public.approval_template_edges
)
DELETE FROM public.approval_template_edges e
USING duplicate_edges d
WHERE e.id = d.id
  AND d.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_template_edges_unique_path
  ON public.approval_template_edges(template_id, from_node_key, to_node_key, edge_type);

ALTER TABLE public.approval_nodes
  ADD COLUMN IF NOT EXISTS scope_strategy text,
  ADD COLUMN IF NOT EXISTS missing_assignee_policy text NOT NULL DEFAULT 'required';

ALTER TABLE public.approval_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_nodes_missing_policy;
ALTER TABLE public.approval_nodes
  ADD CONSTRAINT chk_approval_nodes_missing_policy
  CHECK (missing_assignee_policy IN ('required', 'skip', 'admin_fallback', 'auto_approve'));

CREATE INDEX IF NOT EXISTS idx_approval_business_type_source_rules_lookup
  ON public.approval_business_type_source_rules(document_type, source_scope, match_field, priority)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_approval_business_type_merge_rules_lookup
  ON public.approval_business_type_merge_rules(document_type, match_mode, priority)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_approval_template_routing_rules_lookup
  ON public.approval_template_routing_rules(source_document_type, business_type, priority)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_approval_role_aliases_lookup
  ON public.approval_role_aliases(resolver_type, requested_role_key, priority)
  WHERE is_active = true;

WITH rules(document_type, source_scope, match_field, match_value, result_business_type, priority) AS (
  VALUES
    ('timesheet', 'project', 'project_business_type', 'PMCC', 'PMCC', 10),
    ('timesheet', 'project', 'project_business_type', 'PM', 'PM', 10),
    ('timesheet', 'project', 'project_business_type', 'CC', 'CC', 10),
    ('timesheet', 'project', 'project_code_prefix', 'PMCC', 'PMCC', 20),
    ('timesheet', 'project', 'project_code_prefix', 'PM', 'PM', 30),
    ('timesheet', 'project', 'project_code_prefix', 'CC', 'CC', 30)
)
INSERT INTO public.approval_business_type_source_rules(
  document_type, source_scope, match_field, match_value, result_business_type, priority, is_active
)
SELECT document_type, source_scope, match_field, match_value, result_business_type, priority, true
FROM rules
WHERE NOT EXISTS (
  SELECT 1
  FROM public.approval_business_type_source_rules existing
  WHERE existing.document_type = rules.document_type
    AND existing.source_scope = rules.source_scope
    AND existing.match_field = rules.match_field
    AND existing.match_value = rules.match_value
    AND existing.result_business_type = rules.result_business_type
);

WITH rules(document_type, match_mode, input_business_types, result_business_type, priority) AS (
  VALUES
    ('timesheet', 'any', ARRAY['PMCC']::text[], 'PMCC', 10),
    ('timesheet', 'exact_set', ARRAY['CC', 'PM']::text[], 'PMCC', 20),
    ('timesheet', 'exact_set', ARRAY['PM']::text[], 'PM', 30),
    ('timesheet', 'exact_set', ARRAY['CC']::text[], 'CC', 30)
)
INSERT INTO public.approval_business_type_merge_rules(
  document_type, match_mode, input_business_types, result_business_type, priority, is_active
)
SELECT document_type, match_mode, input_business_types, result_business_type, priority, true
FROM rules
WHERE NOT EXISTS (
  SELECT 1
  FROM public.approval_business_type_merge_rules existing
  WHERE existing.document_type = rules.document_type
    AND existing.match_mode = rules.match_mode
    AND existing.input_business_types = rules.input_business_types
    AND existing.result_business_type = rules.result_business_type
);

WITH rules(source_document_type, target_document_type, business_type, template_key, priority) AS (
  VALUES
    ('timesheet', 'contract_approval', 'PM', 'contract_approval_pm_v1', 10),
    ('timesheet', 'contract_approval', 'CC', 'contract_approval_cc_v1', 10),
    ('timesheet', 'contract_approval', 'PMCC', 'contract_approval_pmcc_v1', 10)
)
INSERT INTO public.approval_template_routing_rules(
  source_document_type, target_document_type, business_type, template_key, priority, is_active
)
SELECT source_document_type, target_document_type, business_type, template_key, priority, true
FROM rules
WHERE NOT EXISTS (
  SELECT 1
  FROM public.approval_template_routing_rules existing
  WHERE existing.source_document_type = rules.source_document_type
    AND existing.target_document_type = rules.target_document_type
    AND existing.business_type IS NOT DISTINCT FROM rules.business_type
    AND existing.template_key IS NOT DISTINCT FROM rules.template_key
);

WITH aliases(resolver_type, requested_role_key, candidate_role_key, priority) AS (
  VALUES
    ('project_role', 'cc_project_owner', 'cc_project_owner', 10),
    ('project_role', 'cc_project_owner', 'cc_mep_project_owner', 20),
    ('project_role', 'cc_project_owner', 'cc_civil_project_owner', 30),
    ('project_role', 'pm_project_owner', 'pm_project_owner', 10),
    ('project_role', 'pm_department_owner', 'pm_department_owner', 10),
    ('project_role', 'cc_department_owner', 'cc_department_owner', 10),
    ('project_role', 'pm_cost_department_owner', 'pm_cost_department_owner', 10)
)
INSERT INTO public.approval_role_aliases(
  document_type, resolver_type, requested_role_key, candidate_role_key, priority, is_active
)
SELECT NULL::text, resolver_type, requested_role_key, candidate_role_key, priority, true
FROM aliases
WHERE NOT EXISTS (
  SELECT 1
  FROM public.approval_role_aliases existing
  WHERE existing.document_type IS NULL
    AND existing.resolver_type = aliases.resolver_type
    AND existing.requested_role_key = aliases.requested_role_key
    AND existing.candidate_role_key = aliases.candidate_role_key
);

INSERT INTO public.approval_engine_settings(setting_key, setting_value)
VALUES
  ('data_driven_business_type_enabled', '{"enabled": true}'::jsonb),
  ('data_driven_template_routing_enabled', '{"enabled": true}'::jsonb),
  ('data_driven_node_expansion_enabled', '{"enabled": true}'::jsonb),
  ('data_driven_role_aliases_enabled', '{"enabled": true}'::jsonb),
  ('data_driven_missing_assignee_policy_enabled', '{"enabled": true}'::jsonb)
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    updated_at = now();

UPDATE public.approval_template_nodes n
SET scope_strategy = CASE
      WHEN n.resolver_type = 'document_creator' OR COALESCE(n.resolver_role, '') = 'submitter'
        THEN 'submitter_virtual'
      ELSE 'per_project'
    END,
    scope_source = CASE
      WHEN n.resolver_type = 'document_creator' OR COALESCE(n.resolver_role, '') = 'submitter'
        THEN 'document'
      ELSE 'timesheet_projects'
    END,
    runtime_scope_type = CASE
      WHEN n.resolver_type = 'document_creator' OR COALESCE(n.resolver_role, '') = 'submitter'
        THEN NULL
      ELSE 'project'
    END,
    runtime_node_key_template = CASE
      WHEN n.resolver_type = 'document_creator' OR COALESCE(n.resolver_role, '') = 'submitter'
        THEN '{node_key}'
      ELSE 'project_{scope_id}_{node_key}'
    END,
    missing_assignee_policy = CASE
      WHEN n.resolver_type = 'document_creator' OR COALESCE(n.resolver_role, '') = 'submitter'
        THEN 'required'
      ELSE 'skip'
    END
FROM public.approval_templates t
WHERE t.id = n.template_id
  AND t.template_key IN (
    'contract_approval_pm_v1',
    'contract_approval_cc_v1',
    'contract_approval_pmcc_v1'
  );

UPDATE public.approval_nodes
SET missing_assignee_policy = 'skip',
    scope_strategy = COALESCE(scope_strategy, 'per_project')
WHERE COALESCE(metadata ->> 'optional', 'false') = 'true';

CREATE OR REPLACE FUNCTION public.psa_resolve_document_business_type(
  p_document_type text,
  p_business_id bigint,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_enabled boolean := true;
  v_business_type text;
BEGIN
  SELECT COALESCE((setting_value ->> 'enabled')::boolean, true)
    INTO v_enabled
    FROM public.approval_engine_settings
   WHERE setting_key = 'data_driven_business_type_enabled';

  v_enabled := COALESCE(v_enabled, true);

  IF p_document_type <> 'timesheet' THEN
    RETURN NULLIF(p_context ->> 'business_type', '');
  END IF;

  IF v_enabled THEN
    WITH project_types AS (
      SELECT DISTINCT resolved.result_business_type
      FROM public.timesheet_entries te
      JOIN public.projects p ON p.id = te.project_id
      JOIN LATERAL (
        SELECT r.result_business_type
        FROM public.approval_business_type_source_rules r
        WHERE r.document_type = p_document_type
          AND r.source_scope = 'project'
          AND r.is_active = true
          AND (
            (
              r.match_field = 'project_business_type'
              AND upper(r.match_value) = upper(NULLIF(p.business_type, ''))
            )
            OR (
              r.match_field = 'project_code_prefix'
              AND upper(p.code) LIKE upper(r.match_value) || '%'
            )
          )
        ORDER BY r.priority, r.id
        LIMIT 1
      ) resolved ON true
      WHERE te.timesheet_id = p_business_id
        AND te.project_id IS NOT NULL
    ),
    type_set AS (
      SELECT COALESCE(array_agg(DISTINCT result_business_type ORDER BY result_business_type), ARRAY[]::text[]) AS business_types
      FROM project_types
      WHERE result_business_type IS NOT NULL
    )
    SELECT r.result_business_type
      INTO v_business_type
      FROM public.approval_business_type_merge_rules r
      CROSS JOIN type_set ts
     WHERE r.document_type = p_document_type
       AND r.is_active = true
       AND (
         (r.match_mode = 'any' AND r.input_business_types && ts.business_types)
         OR (
           r.match_mode = 'exact_set'
           AND ARRAY(SELECT unnest(r.input_business_types) ORDER BY 1) = ts.business_types
         )
       )
     ORDER BY r.priority, r.id
     LIMIT 1;

    IF v_business_type IS NOT NULL THEN
      RETURN v_business_type;
    END IF;
  END IF;

  WITH project_types AS (
    SELECT DISTINCT
      COALESCE(
        NULLIF(p.business_type, ''),
        CASE
          WHEN upper(p.code) LIKE 'PMCC%' THEN 'PMCC'
          WHEN upper(p.code) LIKE 'PM%' THEN 'PM'
          WHEN upper(p.code) LIKE 'CC%' THEN 'CC'
          ELSE NULL
        END
      ) AS business_type
    FROM public.timesheet_entries te
    JOIN public.projects p ON p.id = te.project_id
    WHERE te.timesheet_id = p_business_id
      AND te.project_id IS NOT NULL
  )
  SELECT CASE
    WHEN bool_or(business_type = 'PMCC') THEN 'PMCC'
    WHEN bool_or(business_type = 'PM') AND bool_or(business_type = 'CC') THEN 'PMCC'
    WHEN bool_or(business_type = 'PM') THEN 'PM'
    WHEN bool_or(business_type = 'CC') THEN 'CC'
    ELSE NULL
  END
    INTO v_business_type
    FROM project_types;

  RETURN v_business_type;
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_timesheet_business_type(p_timesheet_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.psa_resolve_document_business_type('timesheet', p_timesheet_id, '{}'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.psa_select_approval_template(
  p_document_type text,
  p_business_id bigint,
  p_business_type text DEFAULT NULL::text,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS public.approval_templates
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_enabled boolean := true;
  v_effective_business_type text := NULLIF(p_business_type, '');
  v_rule record;
  v_template public.approval_templates%rowtype;
BEGIN
  IF v_effective_business_type IS NULL THEN
    v_effective_business_type := public.psa_resolve_document_business_type(p_document_type, p_business_id, p_context);
  END IF;

  SELECT COALESCE((setting_value ->> 'enabled')::boolean, true)
    INTO v_enabled
    FROM public.approval_engine_settings
   WHERE setting_key = 'data_driven_template_routing_enabled';

  v_enabled := COALESCE(v_enabled, true);

  IF v_enabled THEN
    SELECT r.*
      INTO v_rule
      FROM public.approval_template_routing_rules r
     WHERE r.source_document_type = p_document_type
       AND r.is_active = true
       AND (r.business_type IS NULL OR r.business_type IS NOT DISTINCT FROM v_effective_business_type)
     ORDER BY
       CASE WHEN r.business_type IS NOT DISTINCT FROM v_effective_business_type THEN 0 ELSE 1 END,
       r.priority,
       r.id
     LIMIT 1;

    IF v_rule.id IS NOT NULL THEN
      IF NULLIF(v_rule.template_key, '') IS NOT NULL THEN
        SELECT *
          INTO v_template
          FROM public.approval_templates t
         WHERE t.template_key = v_rule.template_key
           AND t.status = 'active'
         LIMIT 1;
      ELSE
        SELECT *
          INTO v_template
          FROM public.approval_templates t
         WHERE t.document_type = v_rule.target_document_type
           AND t.status = 'active'
           AND (t.business_type IS NULL OR t.business_type IS NOT DISTINCT FROM v_effective_business_type)
         ORDER BY
           CASE WHEN t.business_type IS NOT DISTINCT FROM v_effective_business_type THEN 0 ELSE 1 END,
           t.version DESC,
           t.id DESC
         LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF v_template.id IS NOT NULL THEN
    RETURN v_template;
  END IF;

  SELECT *
    INTO v_template
    FROM public.approval_templates t
   WHERE t.status = 'active'
     AND (
       (
         p_document_type = 'timesheet'
         AND t.document_type = 'contract_approval'
         AND (t.business_type IS NULL OR t.business_type IS NOT DISTINCT FROM v_effective_business_type)
       )
       OR (
         t.document_type = p_document_type
         AND (t.business_type IS NULL OR t.business_type IS NOT DISTINCT FROM v_effective_business_type)
       )
     )
   ORDER BY
     CASE
       WHEN p_document_type = 'timesheet' AND t.document_type = 'contract_approval' AND t.business_type IS NOT DISTINCT FROM v_effective_business_type THEN 0
       WHEN p_document_type = 'timesheet' AND t.document_type = 'contract_approval' AND t.business_type IS NULL THEN 1
       WHEN t.document_type = p_document_type AND t.business_type IS NOT DISTINCT FROM v_effective_business_type THEN 2
       WHEN t.document_type = p_document_type AND t.business_type IS NULL THEN 3
       ELSE 4
     END,
     t.version DESC,
     t.id DESC
   LIMIT 1;

  RETURN v_template;
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_resolve_role_candidates(
  p_document_id bigint,
  p_resolver_type text,
  p_resolver_role text,
  p_scope_id bigint DEFAULT NULL::bigint
)
RETURNS TABLE(candidate_role_key text, priority integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH doc AS (
    SELECT
      bd.document_type,
      bd.business_type AS document_business_type,
      ep.cost_specialty,
      o.org_code,
      parent.org_code AS parent_org_code,
      p.business_type AS project_business_type
    FROM public.business_documents bd
    LEFT JOIN public.employee_profiles ep ON ep.employee_id = bd.creator_user_id
    LEFT JOIN public.organizations o ON o.id = ep.org_id
    LEFT JOIN public.organizations parent ON parent.id = o.parent_id
    LEFT JOIN public.projects p ON p.id = COALESCE(NULLIF(p_scope_id, 0), bd.project_id)
    WHERE bd.id = p_document_id
  ),
  matched_aliases AS (
    SELECT
      a.candidate_role_key,
      a.priority
    FROM doc d
    JOIN public.approval_role_aliases a
      ON a.is_active = true
     AND a.resolver_type = p_resolver_type
     AND a.requested_role_key = p_resolver_role
     AND (a.document_type IS NULL OR a.document_type = d.document_type)
     AND (a.business_type IS NULL OR a.business_type = COALESCE(d.project_business_type, d.document_business_type))
     AND (a.org_code IS NULL OR a.org_code = d.org_code)
     AND (a.parent_org_code IS NULL OR a.parent_org_code = d.parent_org_code)
     AND (a.cost_specialty IS NULL OR a.cost_specialty = d.cost_specialty)
  ),
  fallback AS (
    SELECT p_resolver_role AS candidate_role_key, 10000 AS priority
    WHERE p_resolver_role IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM matched_aliases)
  ),
  candidates AS (
    SELECT * FROM matched_aliases
    UNION ALL
    SELECT * FROM fallback
  )
  SELECT DISTINCT ON (candidate_role_key)
    candidate_role_key,
    priority
  FROM candidates
  WHERE candidate_role_key IS NOT NULL AND candidate_role_key <> ''
  ORDER BY candidate_role_key, priority;
$$;

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
      AND om.is_active = TRUE
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
    SELECT * FROM project_role_match
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

CREATE OR REPLACE FUNCTION public.psa_resolve_graph_assignees(
  p_document_id bigint,
  p_resolver_type text,
  p_resolver_role text,
  p_scope_id bigint DEFAULT NULL::bigint
)
RETURNS TABLE(assignee_user_id bigint, route_source text, matched_org_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT *
  FROM public.psa_resolve_graph_assignees(
    p_document_id,
    p_resolver_type,
    p_resolver_role,
    p_scope_id,
    true
  );
$$;

CREATE OR REPLACE FUNCTION public.psa_expand_approval_template(
  p_document_id bigint,
  p_instance_id bigint,
  p_round_id bigint,
  p_template_id bigint,
  p_business_id bigint,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_doc record;
  v_node record;
  v_scope record;
  v_node_key text;
  v_scope_type text;
  v_scope_id bigint;
  v_edge record;
BEGIN
  SELECT bd.document_type, bd.business_id
    INTO v_doc
    FROM public.business_documents bd
   WHERE bd.id = p_document_id;

  IF v_doc.document_type IS NULL THEN
    RAISE EXCEPTION 'No approval business_document found for id=%', p_document_id;
  END IF;

  FOR v_node IN
    SELECT *
    FROM public.approval_template_nodes
    WHERE template_id = p_template_id
    ORDER BY sort_order, node_key
  LOOP
    IF COALESCE(v_node.scope_strategy, 'once_per_document') = 'submitter_virtual' THEN
      CONTINUE;
    END IF;

    IF COALESCE(v_node.scope_strategy, 'once_per_document') = 'per_project'
       AND COALESCE(v_node.scope_source, 'document') = 'timesheet_projects' THEN
      FOR v_scope IN
        SELECT DISTINCT te.project_id AS scope_id
        FROM public.timesheet_entries te
        WHERE te.timesheet_id = p_business_id
          AND te.project_id IS NOT NULL
        ORDER BY te.project_id
      LOOP
        v_scope_id := v_scope.scope_id;
        v_scope_type := COALESCE(NULLIF(v_node.runtime_scope_type, ''), 'project');
        v_node_key := replace(
          replace(COALESCE(NULLIF(v_node.runtime_node_key_template, ''), '{node_key}'), '{node_key}', v_node.node_key),
          '{scope_id}',
          v_scope_id::text
        );

        INSERT INTO public.approval_nodes (
          round_id, instance_id, node_key, template_node_key, node_name, node_type,
          scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
          reject_policy, snapshot, metadata, scope_strategy, missing_assignee_policy
        )
        VALUES (
          p_round_id, p_instance_id, v_node_key, v_node.node_key, v_node.node_name, v_node.node_type,
          v_scope_type, v_scope_id, 'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
          v_node.reject_policy,
          to_jsonb(v_node) || jsonb_build_object('project_id', v_scope_id),
          to_jsonb(v_node) || jsonb_build_object('project_id', v_scope_id, 'template_driven_timesheet', true),
          v_node.scope_strategy,
          v_node.missing_assignee_policy
        );
      END LOOP;
    ELSE
      v_scope_id := NULLIF((p_context ->> 'scope_id')::bigint, 0);
      v_scope_type := COALESCE(NULLIF(v_node.runtime_scope_type, ''), v_doc.document_type);
      v_node_key := replace(
        replace(COALESCE(NULLIF(v_node.runtime_node_key_template, ''), '{node_key}'), '{node_key}', v_node.node_key),
        '{scope_id}',
        COALESCE(v_scope_id::text, '')
      );

      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, snapshot, metadata, scope_strategy, missing_assignee_policy
      )
      VALUES (
        p_round_id, p_instance_id, v_node_key, v_node.node_key, v_node.node_name, v_node.node_type,
        v_scope_type, v_scope_id, 'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
        v_node.reject_policy,
        to_jsonb(v_node),
        to_jsonb(v_node),
        v_node.scope_strategy,
        v_node.missing_assignee_policy
      );
    END IF;
  END LOOP;

  FOR v_edge IN
    SELECT *
    FROM public.approval_template_edges
    WHERE template_id = p_template_id
  LOOP
    INSERT INTO public.approval_edges (
      round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type, condition_expr
    )
    SELECT
      p_round_id,
      p_instance_id,
      from_node.id,
      to_node.id,
      v_edge.edge_type,
      v_edge.edge_type,
      v_edge.condition_expr
    FROM public.approval_nodes from_node
    JOIN public.approval_nodes to_node
      ON to_node.round_id = p_round_id
     AND to_node.template_node_key = v_edge.to_node_key
     AND to_node.scope_type = from_node.scope_type
     AND to_node.scope_id IS NOT DISTINCT FROM from_node.scope_id
    WHERE from_node.round_id = p_round_id
      AND from_node.template_node_key = v_edge.from_node_key
      AND COALESCE(v_edge.scope_join_policy, 'same_scope') = 'same_scope'
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_activate_ready_nodes(p_round_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_node record;
  v_route record;
  v_assignee_user_id bigint;
  v_route_source text;
  v_matched_org_id bigint;
  v_missing_policy text;
  v_progress boolean;
BEGIN
  LOOP
    v_progress := false;

    FOR v_node IN
      SELECT n.*
      FROM public.approval_nodes n
      WHERE n.round_id = p_round_id
        AND n.status IN ('waiting', 'pending')
        AND NOT EXISTS (
          SELECT 1
          FROM public.approval_edges e
          JOIN public.approval_nodes from_node ON from_node.id = e.from_node_id
          WHERE e.round_id = p_round_id
            AND e.to_node_id = n.id
            AND e.condition_result = true
            AND from_node.status NOT IN ('approved', 'skipped')
        )
      ORDER BY n.id
    LOOP
      v_progress := true;
      v_assignee_user_id := NULL;
      v_route_source := NULL;
      v_matched_org_id := NULL;
      v_missing_policy := COALESCE(
        NULLIF(v_node.missing_assignee_policy, ''),
        CASE WHEN COALESCE(v_node.metadata ->> 'optional', 'false') = 'true' THEN 'skip' ELSE 'required' END
      );

      UPDATE public.approval_nodes
      SET status = 'active',
          activated_at = COALESCE(activated_at, now()),
          updated_at = now()
      WHERE id = v_node.id
        AND status IN ('waiting', 'pending');

      IF v_node.approval_policy = 'auto_pass' THEN
        UPDATE public.approval_nodes
        SET status = 'approved',
            completed_at = now(),
            result_action = 'approve',
            updated_at = now()
        WHERE id = v_node.id;
      ELSE
        IF v_node.assignee_user_id IS NOT NULL THEN
          v_assignee_user_id := v_node.assignee_user_id;
          v_route_source := COALESCE(v_node.snapshot ->> 'route_source', v_node.resolver_role);
          v_matched_org_id := NULL;
        ELSE
          SELECT * INTO v_route
          FROM public.psa_resolve_graph_assignees(
            (SELECT ai.document_id FROM public.approval_instances ai WHERE ai.id = v_node.instance_id),
            v_node.resolver_type,
            v_node.resolver_role,
            v_node.scope_id,
            v_missing_policy <> 'skip'
          )
          LIMIT 1;

          v_assignee_user_id := v_route.assignee_user_id;
          v_route_source := v_route.route_source;
          v_matched_org_id := v_route.matched_org_id;
        END IF;

        IF v_assignee_user_id IS NULL THEN
          IF v_missing_policy = 'skip' THEN
            UPDATE public.approval_nodes
            SET status = 'skipped',
                result_action = 'skipped',
                completed_at = now(),
                comment = COALESCE(NULLIF(comment, ''), 'No configured approver; optional node skipped'),
                snapshot = snapshot || jsonb_build_object('route_source', 'optional_unresolved_skipped'),
                updated_at = now()
            WHERE id = v_node.id;
            CONTINUE;
          ELSIF v_missing_policy = 'auto_approve' THEN
            UPDATE public.approval_nodes
            SET status = 'approved',
                result_action = 'approve',
                completed_at = now(),
                comment = COALESCE(NULLIF(comment, ''), 'No configured approver; auto-approved by policy'),
                snapshot = snapshot || jsonb_build_object('route_source', 'auto_approve_no_assignee'),
                updated_at = now()
            WHERE id = v_node.id;
            CONTINUE;
          END IF;

          RAISE EXCEPTION 'No assignee resolved for node %', v_node.node_key;
        END IF;

        INSERT INTO public.approval_node_assignees (
          node_id, assignee_user_id, assignee_employee_id, assignee_org_id, status
        )
        VALUES (
          v_node.id, v_assignee_user_id, v_assignee_user_id, v_matched_org_id, 'pending'
        )
        ON CONFLICT (node_id, assignee_user_id) DO NOTHING;

        UPDATE public.approval_nodes
        SET assignee_user_id = COALESCE(assignee_user_id, v_assignee_user_id),
            assignee_role = COALESCE(assignee_role, resolver_role),
            snapshot = snapshot || jsonb_build_object(
              'resolved_assignee_user_id', v_assignee_user_id,
              'route_source', v_route_source,
              'matched_org_id', v_matched_org_id
            ),
            updated_at = now()
        WHERE id = v_node.id;
      END IF;
    END LOOP;

    EXIT WHEN NOT v_progress;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_document(
  p_document_type text,
  p_business_id bigint,
  p_business_version integer DEFAULT 1,
  p_business_type text DEFAULT NULL::text,
  p_creator_user_id bigint DEFAULT NULL::bigint,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_request_id text DEFAULT NULL::text
)
RETURNS TABLE(document_id bigint, instance_id bigint, round_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_creator bigint := COALESCE(p_creator_user_id, public.current_employee_id());
  v_creator_org bigint;
  v_project_id bigint;
  v_template public.approval_templates%rowtype;
  v_effective_business_type text := NULLIF(p_business_type, '');
  v_snapshot jsonb;
  v_doc_id bigint;
  v_instance_id bigint;
  v_round_id bigint;
  v_terminal_unapproved int;
BEGIN
  SELECT ep.org_id INTO v_creator_org
  FROM public.employee_profiles ep
  WHERE ep.employee_id = v_creator
  LIMIT 1;

  IF p_document_type = 'timesheet' THEN
    SELECT te.project_id INTO v_project_id
    FROM public.timesheet_entries te
    WHERE te.timesheet_id = p_business_id
    ORDER BY te.project_id
    LIMIT 1;

    v_effective_business_type := COALESCE(
      v_effective_business_type,
      public.psa_resolve_document_business_type(p_document_type, p_business_id, p_context)
    );
  ELSE
    v_project_id := NULLIF((p_context ->> 'project_id')::bigint, 0);
  END IF;

  SELECT * INTO v_template
  FROM public.psa_select_approval_template(
    p_document_type,
    p_business_id,
    v_effective_business_type,
    p_context
  );

  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'No active approval template for document_type=% business_type=%', p_document_type, v_effective_business_type;
  END IF;

  INSERT INTO public.business_documents (
    document_type, business_id, business_version, creator_user_id, creator_employee_id,
    creator_org_id, project_id, business_type, lifecycle_status, submitted_at
  )
  VALUES (
    p_document_type, p_business_id, p_business_version, v_creator, v_creator,
    v_creator_org, v_project_id, v_effective_business_type, 'in_approval', now()
  )
  ON CONFLICT (document_type, business_id, business_version) DO UPDATE
  SET lifecycle_status = 'in_approval',
      business_type = EXCLUDED.business_type,
      submitted_at = COALESCE(public.business_documents.submitted_at, now()),
      updated_at = now()
  RETURNING id INTO v_doc_id;

  SELECT ai.id INTO v_instance_id
  FROM public.approval_instances ai
  WHERE ai.document_id = v_doc_id
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    SELECT ai.id INTO v_instance_id
    FROM public.approval_instances ai
    WHERE ai.target_type = p_document_type
      AND ai.target_id = p_business_id
    LIMIT 1;

    IF v_instance_id IS NOT NULL THEN
      UPDATE public.approval_instances ai
      SET document_id = v_doc_id,
          template_id = v_template.id,
          template_version = v_template.version,
          template_snapshot = public.psa_template_snapshot(v_template.id),
          status = 'running',
          updated_at = now()
      WHERE ai.id = v_instance_id;
    END IF;
  END IF;

  IF v_instance_id IS NOT NULL THEN
    SELECT ai.current_round_id INTO v_round_id
    FROM public.approval_instances ai
    WHERE ai.id = v_instance_id;
    submit_document.document_id := v_doc_id;
    submit_document.instance_id := v_instance_id;
    submit_document.round_id := v_round_id;
    RETURN NEXT;
    RETURN;
  END IF;

  v_snapshot := public.psa_template_snapshot(v_template.id);

  INSERT INTO public.approval_instances (
    approval_key, target_type, target_id, document_id, template_id, template_version,
    template_snapshot, status, current_round, created_by
  )
  VALUES (
    p_document_type, p_document_type, p_business_id, v_doc_id, v_template.id, v_template.version,
    v_snapshot, 'running', 1, v_creator
  )
  RETURNING id INTO v_instance_id;

  INSERT INTO public.approval_rounds (
    instance_id, round_no, round_type, status, started_by, created_by, reason
  )
  VALUES (v_instance_id, 1, 'initial_submit', 'running', v_creator, v_creator, 'submit_document')
  RETURNING id INTO v_round_id;

  UPDATE public.approval_instances ai
  SET current_round_id = v_round_id, current_round = 1, updated_at = now()
  WHERE ai.id = v_instance_id;

  PERFORM public.psa_expand_approval_template(
    v_doc_id,
    v_instance_id,
    v_round_id,
    v_template.id,
    p_business_id,
    p_context
  );

  PERFORM public.psa_activate_ready_nodes(v_round_id);
  PERFORM public.psa_write_approval_event(
    v_instance_id, v_round_id, NULL, NULL, v_creator, 'document_submitted',
    'draft', 'in_approval', p_request_id, '', p_context
  );

  SELECT count(*) INTO v_terminal_unapproved
  FROM public.approval_nodes n
  WHERE n.round_id = v_round_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.approval_edges e
      WHERE e.round_id = v_round_id
        AND e.from_node_id = n.id
        AND e.condition_result = true
    )
    AND n.status NOT IN ('approved', 'skipped');

  IF v_terminal_unapproved = 0 THEN
    UPDATE public.approval_rounds
    SET status = 'approved', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_round_id AND status = 'running';

    UPDATE public.approval_instances
    SET status = 'approved', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_instance_id AND status = 'running';

    UPDATE public.business_documents
    SET lifecycle_status = 'approved', approved_at = COALESCE(approved_at, now()), updated_at = now()
    WHERE id = v_doc_id;

    IF p_document_type = 'timesheet' THEN
      UPDATE public.timesheets
      SET status = 'approved', approved_at = now(), updated_at = now()
      WHERE id = p_business_id;
    END IF;
  END IF;

  submit_document.document_id := v_doc_id;
  submit_document.instance_id := v_instance_id;
  submit_document.round_id := v_round_id;
  RETURN NEXT;
END;
$$;

ALTER TABLE public.approval_business_type_source_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_business_type_merge_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_template_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_role_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_engine_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read approval business type source rules"
  ON public.approval_business_type_source_rules;
CREATE POLICY "Authenticated read approval business type source rules"
  ON public.approval_business_type_source_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read approval business type merge rules"
  ON public.approval_business_type_merge_rules;
CREATE POLICY "Authenticated read approval business type merge rules"
  ON public.approval_business_type_merge_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read approval template routing rules"
  ON public.approval_template_routing_rules;
CREATE POLICY "Authenticated read approval template routing rules"
  ON public.approval_template_routing_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read approval role aliases"
  ON public.approval_role_aliases;
CREATE POLICY "Authenticated read approval role aliases"
  ON public.approval_role_aliases FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read approval engine settings"
  ON public.approval_engine_settings;
CREATE POLICY "Authenticated read approval engine settings"
  ON public.approval_engine_settings FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.approval_business_type_source_rules TO authenticated;
GRANT SELECT ON public.approval_business_type_merge_rules TO authenticated;
GRANT SELECT ON public.approval_template_routing_rules TO authenticated;
GRANT SELECT ON public.approval_role_aliases TO authenticated;
GRANT SELECT ON public.approval_engine_settings TO authenticated;

GRANT ALL ON public.approval_business_type_source_rules TO service_role;
GRANT ALL ON public.approval_business_type_merge_rules TO service_role;
GRANT ALL ON public.approval_template_routing_rules TO service_role;
GRANT ALL ON public.approval_role_aliases TO service_role;
GRANT ALL ON public.approval_engine_settings TO service_role;

GRANT ALL ON SEQUENCE public.approval_business_type_source_rules_id_seq TO service_role;
GRANT ALL ON SEQUENCE public.approval_business_type_merge_rules_id_seq TO service_role;
GRANT ALL ON SEQUENCE public.approval_template_routing_rules_id_seq TO service_role;
GRANT ALL ON SEQUENCE public.approval_role_aliases_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.psa_resolve_document_business_type(text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_timesheet_business_type(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_select_approval_template(text, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_resolve_role_candidates(bigint, text, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_resolve_graph_assignees(bigint, text, text, bigint, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_resolve_graph_assignees(bigint, text, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_expand_approval_template(bigint, bigint, bigint, bigint, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_activate_ready_nodes(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_document(text, bigint, integer, text, bigint, jsonb, text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
