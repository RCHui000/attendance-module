-- V0.18.2: route PMCC timesheets by submitter-side organization.
--
-- PMCC is a project service type, but weekly timesheet approval should use
-- the submitter's department side. CC submitters keep the cross-department
-- PMCC route; PM/design-side submitters use the PM-side route.

BEGIN;

CREATE TABLE IF NOT EXISTS public.approval_submitter_business_type_route_rules (
  id bigserial PRIMARY KEY,
  document_type text NOT NULL,
  input_business_type text NOT NULL,
  submitter_org_code text,
  submitter_parent_org_code text,
  result_business_type text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_submitter_business_type_route_rules
  DROP CONSTRAINT IF EXISTS chk_approval_submitter_route_business_type;
ALTER TABLE public.approval_submitter_business_type_route_rules
  ADD CONSTRAINT chk_approval_submitter_route_business_type
  CHECK (
    input_business_type IN ('PM', 'CC', 'PMCC')
    AND result_business_type IN ('PM', 'CC', 'PMCC')
  );

CREATE INDEX IF NOT EXISTS idx_approval_submitter_route_rules_lookup
  ON public.approval_submitter_business_type_route_rules(
    document_type,
    input_business_type,
    submitter_org_code,
    submitter_parent_org_code,
    priority
  )
  WHERE is_active = true;

WITH rules(document_type, input_business_type, submitter_org_code, submitter_parent_org_code, result_business_type, priority) AS (
  VALUES
    ('timesheet', 'PMCC', 'PM_DESIGN', NULL, 'PM', 10),
    ('timesheet', 'PMCC', 'PM', NULL, 'PM', 20),
    ('timesheet', 'PMCC', NULL, 'PM', 'PM', 30)
)
INSERT INTO public.approval_submitter_business_type_route_rules(
  document_type,
  input_business_type,
  submitter_org_code,
  submitter_parent_org_code,
  result_business_type,
  priority,
  is_active
)
SELECT document_type, input_business_type, submitter_org_code, submitter_parent_org_code, result_business_type, priority, true
FROM rules
WHERE NOT EXISTS (
  SELECT 1
  FROM public.approval_submitter_business_type_route_rules existing
  WHERE existing.document_type = rules.document_type
    AND existing.input_business_type = rules.input_business_type
    AND existing.submitter_org_code IS NOT DISTINCT FROM rules.submitter_org_code
    AND existing.submitter_parent_org_code IS NOT DISTINCT FROM rules.submitter_parent_org_code
    AND existing.result_business_type = rules.result_business_type
);

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
  v_routed_business_type text;
  v_submitter_org_code text;
  v_submitter_parent_org_code text;
BEGIN
  SELECT COALESCE((setting_value ->> 'enabled')::boolean, true)
    INTO v_enabled
    FROM public.approval_engine_settings
   WHERE setting_key = 'data_driven_business_type_enabled';

  v_enabled := COALESCE(v_enabled, true);

  IF p_document_type <> 'timesheet' THEN
    RETURN NULLIF(p_context ->> 'business_type', '');
  END IF;

  SELECT o.org_code, parent.org_code
    INTO v_submitter_org_code, v_submitter_parent_org_code
    FROM public.timesheets t
    LEFT JOIN public.employee_profiles ep ON ep.employee_id = t.user_id
    LEFT JOIN public.organizations o ON o.id = ep.org_id
    LEFT JOIN public.organizations parent ON parent.id = o.parent_id
   WHERE t.id = p_business_id
   LIMIT 1;

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
      SELECT r.result_business_type
        INTO v_routed_business_type
        FROM public.approval_submitter_business_type_route_rules r
       WHERE r.document_type = p_document_type
         AND r.input_business_type = v_business_type
         AND r.is_active = true
         AND (r.submitter_org_code IS NULL OR r.submitter_org_code = v_submitter_org_code)
         AND (r.submitter_parent_org_code IS NULL OR r.submitter_parent_org_code = v_submitter_parent_org_code)
       ORDER BY
         CASE WHEN r.submitter_org_code IS NOT NULL THEN 0 ELSE 1 END,
         CASE WHEN r.submitter_parent_org_code IS NOT NULL THEN 0 ELSE 1 END,
         r.priority,
         r.id
       LIMIT 1;

      RETURN COALESCE(v_routed_business_type, v_business_type);
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

  SELECT r.result_business_type
    INTO v_routed_business_type
    FROM public.approval_submitter_business_type_route_rules r
   WHERE r.document_type = p_document_type
     AND r.input_business_type = v_business_type
     AND r.is_active = true
     AND (r.submitter_org_code IS NULL OR r.submitter_org_code = v_submitter_org_code)
     AND (r.submitter_parent_org_code IS NULL OR r.submitter_parent_org_code = v_submitter_parent_org_code)
   ORDER BY
     CASE WHEN r.submitter_org_code IS NOT NULL THEN 0 ELSE 1 END,
     CASE WHEN r.submitter_parent_org_code IS NOT NULL THEN 0 ELSE 1 END,
     r.priority,
     r.id
   LIMIT 1;

  RETURN COALESCE(v_routed_business_type, v_business_type);
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

WITH pm_template AS (
  SELECT id, version
  FROM public.approval_templates
  WHERE template_key = 'contract_approval_pm_v1'
    AND status = 'active'
  ORDER BY version DESC, id DESC
  LIMIT 1
),
affected AS (
  SELECT i.id AS instance_id, bd.id AS document_id, pm_template.id AS template_id, pm_template.version AS template_version
  FROM public.approval_instances i
  JOIN public.business_documents bd ON bd.id = i.document_id
  JOIN pm_template ON true
  WHERE COALESCE(i.target_type, bd.document_type) = 'timesheet'
    AND i.status = 'running'
    AND public.psa_resolve_document_business_type('timesheet', COALESCE(i.target_id, bd.business_id), '{}'::jsonb) = 'PM'
    AND bd.business_type = 'PMCC'
)
UPDATE public.business_documents bd
SET business_type = 'PM',
    updated_at = now()
FROM affected a
WHERE bd.id = a.document_id;

WITH pm_template AS (
  SELECT id, version
  FROM public.approval_templates
  WHERE template_key = 'contract_approval_pm_v1'
    AND status = 'active'
  ORDER BY version DESC, id DESC
  LIMIT 1
),
affected AS (
  SELECT i.id AS instance_id, pm_template.id AS template_id, pm_template.version AS template_version
  FROM public.approval_instances i
  JOIN public.business_documents bd ON bd.id = i.document_id
  JOIN pm_template ON true
  WHERE COALESCE(i.target_type, bd.document_type) = 'timesheet'
    AND i.status = 'running'
    AND bd.business_type = 'PM'
    AND i.template_id IS DISTINCT FROM pm_template.id
    AND public.psa_resolve_document_business_type('timesheet', COALESCE(i.target_id, bd.business_id), '{}'::jsonb) = 'PM'
)
UPDATE public.approval_instances i
SET template_id = a.template_id,
    template_version = a.template_version,
    updated_at = now()
FROM affected a
WHERE i.id = a.instance_id;

ALTER TABLE public.approval_submitter_business_type_route_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read approval submitter route rules" ON public.approval_submitter_business_type_route_rules;
CREATE POLICY "Authenticated read approval submitter route rules"
  ON public.approval_submitter_business_type_route_rules
  FOR SELECT TO authenticated
  USING (is_active = true);

GRANT SELECT ON public.approval_submitter_business_type_route_rules TO authenticated;
GRANT ALL ON public.approval_submitter_business_type_route_rules TO service_role;
GRANT ALL ON SEQUENCE public.approval_submitter_business_type_route_rules_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.psa_resolve_document_business_type(text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_timesheet_business_type(bigint) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
