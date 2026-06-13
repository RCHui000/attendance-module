-- V0.14: Approval Graph B core model and Timesheet entrypoint.
-- This migration upgrades the existing bigint PSA schema without replacing
-- the V0.12 read-model tables. workflow_tasks remains as a compatibility
-- projection only; new approval actions write approval_events.

BEGIN;

CREATE TABLE IF NOT EXISTS public.business_documents (
  id BIGSERIAL PRIMARY KEY,
  document_type TEXT NOT NULL,
  business_id BIGINT NOT NULL,
  business_version INT NOT NULL DEFAULT 1,
  creator_user_id BIGINT NOT NULL,
  creator_employee_id BIGINT,
  creator_org_id BIGINT,
  project_id BIGINT,
  business_type TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_type, business_id, business_version)
);

CREATE TABLE IF NOT EXISTS public.approval_templates (
  id BIGSERIAL PRIMARY KEY,
  template_key TEXT UNIQUE NOT NULL,
  document_type TEXT NOT NULL,
  business_type TEXT,
  name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.approval_template_nodes (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES public.approval_templates(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_name TEXT NOT NULL,
  node_type TEXT NOT NULL DEFAULT 'approval',
  resolver_type TEXT NOT NULL,
  resolver_role TEXT,
  approval_policy TEXT NOT NULL DEFAULT 'single',
  reject_policy TEXT NOT NULL DEFAULT 'back_to_creator',
  allow_delegate BOOLEAN NOT NULL DEFAULT false,
  allow_skip BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  UNIQUE(template_id, node_key)
);

CREATE TABLE IF NOT EXISTS public.approval_template_edges (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES public.approval_templates(id) ON DELETE CASCADE,
  from_node_key TEXT NOT NULL,
  to_node_key TEXT NOT NULL,
  condition_expr JSONB NOT NULL DEFAULT '{}'::jsonb,
  edge_type TEXT NOT NULL DEFAULT 'normal'
);

CREATE TABLE IF NOT EXISTS public.approval_node_assignees (
  id BIGSERIAL PRIMARY KEY,
  node_id BIGINT NOT NULL REFERENCES public.approval_nodes(id) ON DELETE CASCADE,
  assignee_user_id BIGINT NOT NULL,
  assignee_employee_id BIGINT,
  assignee_org_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  action TEXT,
  comment TEXT,
  acted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(node_id, assignee_user_id)
);

CREATE TABLE IF NOT EXISTS public.project_roles (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES public.projects(id),
  org_id BIGINT REFERENCES public.organizations(id),
  role_key TEXT NOT NULL,
  employee_id BIGINT NOT NULL REFERENCES public.employees(id),
  user_id BIGINT NOT NULL REFERENCES public.employees(id),
  valid_from DATE,
  valid_to DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_instances ADD COLUMN IF NOT EXISTS document_id BIGINT REFERENCES public.business_documents(id);
ALTER TABLE public.approval_instances ADD COLUMN IF NOT EXISTS template_id BIGINT REFERENCES public.approval_templates(id);
ALTER TABLE public.approval_instances ADD COLUMN IF NOT EXISTS template_version INT NOT NULL DEFAULT 1;
ALTER TABLE public.approval_instances ADD COLUMN IF NOT EXISTS template_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.approval_instances ADD COLUMN IF NOT EXISTS current_round INT NOT NULL DEFAULT 1;

ALTER TABLE public.approval_rounds ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.approval_rounds ADD COLUMN IF NOT EXISTS created_by BIGINT;

ALTER TABLE public.approval_nodes ADD COLUMN IF NOT EXISTS instance_id BIGINT REFERENCES public.approval_instances(id) ON DELETE CASCADE;
ALTER TABLE public.approval_nodes ADD COLUMN IF NOT EXISTS template_node_key TEXT;
ALTER TABLE public.approval_nodes ADD COLUMN IF NOT EXISTS node_name TEXT;
ALTER TABLE public.approval_nodes ADD COLUMN IF NOT EXISTS resolver_type TEXT NOT NULL DEFAULT 'project_role';
ALTER TABLE public.approval_nodes ADD COLUMN IF NOT EXISTS resolver_role TEXT;
ALTER TABLE public.approval_nodes ADD COLUMN IF NOT EXISTS approval_policy TEXT NOT NULL DEFAULT 'single';
ALTER TABLE public.approval_nodes ADD COLUMN IF NOT EXISTS reject_policy TEXT NOT NULL DEFAULT 'back_to_creator';
ALTER TABLE public.approval_nodes ADD COLUMN IF NOT EXISTS snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.approval_edges ADD COLUMN IF NOT EXISTS instance_id BIGINT REFERENCES public.approval_instances(id) ON DELETE CASCADE;
ALTER TABLE public.approval_edges ADD COLUMN IF NOT EXISTS edge_type TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE public.approval_edges ADD COLUMN IF NOT EXISTS condition_result BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.approval_events ADD COLUMN IF NOT EXISTS assignee_id BIGINT REFERENCES public.approval_node_assignees(id) ON DELETE SET NULL;
ALTER TABLE public.approval_events ADD COLUMN IF NOT EXISTS actor_user_id BIGINT;
ALTER TABLE public.approval_events ADD COLUMN IF NOT EXISTS actor_employee_id BIGINT;
ALTER TABLE public.approval_events ADD COLUMN IF NOT EXISTS from_status TEXT;
ALTER TABLE public.approval_events ADD COLUMN IF NOT EXISTS to_status TEXT;
ALTER TABLE public.approval_events ADD COLUMN IF NOT EXISTS request_id TEXT;

UPDATE public.approval_nodes n
SET instance_id = r.instance_id,
    template_node_key = COALESCE(n.template_node_key, n.node_key),
    node_name = COALESCE(n.node_name, n.node_key),
    resolver_role = COALESCE(n.resolver_role, n.assignee_role),
    snapshot = COALESCE(NULLIF(n.snapshot, '{}'::jsonb), n.metadata, '{}'::jsonb)
FROM public.approval_rounds r
WHERE n.round_id = r.id
  AND (n.instance_id IS NULL OR n.template_node_key IS NULL OR n.node_name IS NULL);

UPDATE public.approval_edges e
SET instance_id = r.instance_id,
    edge_type = COALESCE(e.edge_type, e.condition_type, 'normal')
FROM public.approval_rounds r
WHERE e.round_id = r.id AND e.instance_id IS NULL;

ALTER TABLE public.business_documents
  DROP CONSTRAINT IF EXISTS chk_business_documents_lifecycle_status;
ALTER TABLE public.business_documents
  ADD CONSTRAINT chk_business_documents_lifecycle_status
  CHECK (lifecycle_status IN ('draft', 'in_approval', 'revision_required', 'approved', 'cancelled', 'archived'));

ALTER TABLE public.approval_templates
  DROP CONSTRAINT IF EXISTS chk_approval_templates_status;
ALTER TABLE public.approval_templates
  ADD CONSTRAINT chk_approval_templates_status
  CHECK (status IN ('draft', 'active', 'inactive', 'archived'));

ALTER TABLE public.approval_template_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_template_nodes_node_type;
ALTER TABLE public.approval_template_nodes
  ADD CONSTRAINT chk_approval_template_nodes_node_type
  CHECK (node_type IN ('approval', 'condition', 'merge', 'notify', 'auto'));

ALTER TABLE public.approval_template_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_template_nodes_resolver_type;
ALTER TABLE public.approval_template_nodes
  ADD CONSTRAINT chk_approval_template_nodes_resolver_type
  CHECK (resolver_type IN ('project_role', 'org_manager', 'fixed_user', 'document_creator', 'expression_limited'));

ALTER TABLE public.approval_template_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_template_nodes_approval_policy;
ALTER TABLE public.approval_template_nodes
  ADD CONSTRAINT chk_approval_template_nodes_approval_policy
  CHECK (approval_policy IN ('all', 'any', 'single', 'auto_pass'));

ALTER TABLE public.approval_node_assignees
  DROP CONSTRAINT IF EXISTS chk_approval_node_assignees_status;
ALTER TABLE public.approval_node_assignees
  ADD CONSTRAINT chk_approval_node_assignees_status
  CHECK (status IN ('pending', 'approved', 'rejected', 'delegated', 'skipped', 'cancelled'));

ALTER TABLE public.project_roles
  DROP CONSTRAINT IF EXISTS chk_project_roles_status;
ALTER TABLE public.project_roles
  ADD CONSTRAINT chk_project_roles_status
  CHECK (status IN ('active', 'inactive'));

ALTER TABLE public.project_roles
  DROP CONSTRAINT IF EXISTS chk_project_roles_dates;
ALTER TABLE public.project_roles
  ADD CONSTRAINT chk_project_roles_dates
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from);

ALTER TABLE public.approval_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_nodes_status;
ALTER TABLE public.approval_nodes
  ADD CONSTRAINT chk_approval_nodes_status
  CHECK (status IN (
    'waiting', 'pending', 'active', 'approved', 'rejected', 'skipped',
    'cancelled', 'waiting_revision', 'revision_required',
    'needs_revision', 'needs_reapproval'
  ));

ALTER TABLE public.approval_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_nodes_scope;
ALTER TABLE public.approval_nodes
  ADD CONSTRAINT chk_approval_nodes_scope
  CHECK (
    (scope_type = 'project' AND scope_id IS NOT NULL)
    OR (scope_type IN ('timesheet', 'department_summary') AND scope_id IS NULL)
    OR (scope_type IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS approval_events_request_uidx
  ON public.approval_events(instance_id, request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS approval_nodes_active_idx ON public.approval_nodes(status, round_id);
CREATE INDEX IF NOT EXISTS approval_assignees_todo_idx ON public.approval_node_assignees(assignee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_business_documents_business ON public.business_documents(document_type, business_id, business_version);
CREATE INDEX IF NOT EXISTS idx_project_roles_project_role ON public.project_roles(project_id, role_key, status);

CREATE OR REPLACE FUNCTION public.psa_template_snapshot(p_template_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT jsonb_build_object(
    'template', to_jsonb(t),
    'nodes', COALESCE((
      SELECT jsonb_agg(to_jsonb(n) ORDER BY n.sort_order, n.node_key)
      FROM public.approval_template_nodes n
      WHERE n.template_id = t.id
    ), '[]'::jsonb),
    'edges', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.from_node_key, e.to_node_key)
      FROM public.approval_template_edges e
      WHERE e.template_id = t.id
    ), '[]'::jsonb)
  )
  FROM public.approval_templates t
  WHERE t.id = p_template_id;
$$;

CREATE OR REPLACE FUNCTION public.psa_resolve_graph_assignees(
  p_document_id bigint,
  p_resolver_type text,
  p_resolver_role text,
  p_scope_id bigint DEFAULT NULL
)
RETURNS TABLE(assignee_user_id bigint, route_source text, matched_org_id bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH doc AS (
    SELECT *
    FROM public.business_documents
    WHERE id = p_document_id
  ),
  project_role_match AS (
    SELECT pr.user_id AS assignee_user_id, 'project_roles'::text AS route_source, pr.org_id AS matched_org_id, 1 AS priority
    FROM public.project_roles pr
    JOIN doc d ON d.project_id = pr.project_id OR pr.project_id = COALESCE(p_scope_id, d.project_id)
    WHERE p_resolver_type = 'project_role'
      AND pr.role_key = COALESCE(p_resolver_role, 'project_owner')
      AND pr.status = 'active'
      AND (pr.valid_from IS NULL OR pr.valid_from <= current_date)
      AND (pr.valid_to IS NULL OR pr.valid_to >= current_date)
    ORDER BY pr.org_id NULLS LAST, pr.id DESC
    LIMIT 1
  ),
  timesheet_project_owner AS (
    SELECT route.assignee_user_id, route.route_source, route.matched_org_id, 2 AS priority
    FROM doc d
    JOIN LATERAL public.psa_resolve_project_review_assignee(
      COALESCE(p_scope_id, d.project_id),
      d.creator_user_id,
      d.creator_org_id
    ) route ON true
    WHERE p_resolver_type = 'project_role'
      AND p_resolver_role IN ('project_owner', 'pm_project_owner', 'cc_project_owner', 'cost_project_owner')
      AND d.document_type = 'timesheet'
      AND COALESCE(p_scope_id, d.project_id) IS NOT NULL
    LIMIT 1
  ),
  org_manager AS (
    SELECT o.manager_user_id AS assignee_user_id, 'org_manager'::text AS route_source, o.id AS matched_org_id, 3 AS priority
    FROM doc d
    JOIN public.organizations o ON o.id = d.creator_org_id
    WHERE p_resolver_type = 'org_manager'
      AND NULLIF(o.manager_user_id, 0) IS NOT NULL
    LIMIT 1
  ),
  creator AS (
    SELECT d.creator_user_id AS assignee_user_id, 'document_creator'::text AS route_source, d.creator_org_id AS matched_org_id, 4 AS priority
    FROM doc d
    WHERE p_resolver_type = 'document_creator'
  ),
  admin_fallback AS (
    SELECT ur.employee_id AS assignee_user_id, 'admin_fallback'::text AS route_source, NULL::bigint AS matched_org_id, 99 AS priority
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
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
  ORDER BY priority
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.psa_write_approval_event(
  p_instance_id bigint,
  p_round_id bigint,
  p_node_id bigint,
  p_assignee_id bigint,
  p_actor_user_id bigint,
  p_event_type text,
  p_from_status text,
  p_to_status text,
  p_request_id text,
  p_comment text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_event_id bigint;
BEGIN
  IF p_request_id IS NOT NULL THEN
    SELECT id INTO v_event_id
    FROM public.approval_events
    WHERE instance_id = p_instance_id AND request_id = p_request_id
    LIMIT 1;

    IF v_event_id IS NOT NULL THEN
      RETURN v_event_id;
    END IF;
  END IF;

  INSERT INTO public.approval_events (
    instance_id, round_id, node_id, assignee_id, actor_id, actor_user_id, actor_employee_id,
    event_type, from_status, to_status, request_id, comment, payload
  )
  VALUES (
    p_instance_id, p_round_id, p_node_id, p_assignee_id, p_actor_user_id, p_actor_user_id, p_actor_user_id,
    p_event_type, p_from_status, p_to_status, p_request_id, COALESCE(p_comment, ''), COALESCE(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
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
BEGIN
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
  LOOP
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
      SELECT * INTO v_route
      FROM public.psa_resolve_graph_assignees(
        (SELECT document_id FROM public.approval_instances WHERE id = v_node.instance_id),
        v_node.resolver_type,
        v_node.resolver_role,
        v_node.scope_id
      )
      LIMIT 1;

      IF v_route.assignee_user_id IS NULL THEN
        RAISE EXCEPTION 'No assignee resolved for node %', v_node.node_key;
      END IF;

      INSERT INTO public.approval_node_assignees (
        node_id, assignee_user_id, assignee_employee_id, assignee_org_id, status
      )
      VALUES (
        v_node.id, v_route.assignee_user_id, v_route.assignee_user_id, v_route.matched_org_id, 'pending'
      )
      ON CONFLICT (node_id, assignee_user_id) DO NOTHING;

      UPDATE public.approval_nodes
      SET assignee_user_id = COALESCE(assignee_user_id, v_route.assignee_user_id),
          assignee_role = COALESCE(assignee_role, resolver_role),
          snapshot = snapshot || jsonb_build_object(
            'resolved_assignee_user_id', v_route.assignee_user_id,
            'route_source', v_route.route_source,
            'matched_org_id', v_route.matched_org_id
          ),
          updated_at = now()
      WHERE id = v_node.id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_document(
  p_document_type text,
  p_business_id bigint,
  p_business_version int DEFAULT 1,
  p_business_type text DEFAULT NULL,
  p_creator_user_id bigint DEFAULT NULL,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_request_id text DEFAULT NULL
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
  v_snapshot jsonb;
  v_doc_id bigint;
  v_instance_id bigint;
  v_round_id bigint;
  v_node record;
  v_new_node_id bigint;
  v_from_id bigint;
  v_to_id bigint;
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
  ELSE
    v_project_id := NULLIF((p_context ->> 'project_id')::bigint, 0);
  END IF;

  SELECT * INTO v_template
  FROM public.approval_templates
  WHERE document_type = p_document_type
    AND status = 'active'
    AND (business_type IS NULL OR business_type = p_business_type)
  ORDER BY CASE WHEN business_type = p_business_type THEN 0 ELSE 1 END, version DESC, id DESC
  LIMIT 1;

  IF v_template.id IS NULL THEN
    RAISE EXCEPTION 'No active approval template for document_type=% business_type=%', p_document_type, p_business_type;
  END IF;

  INSERT INTO public.business_documents (
    document_type, business_id, business_version, creator_user_id, creator_employee_id,
    creator_org_id, project_id, business_type, lifecycle_status, submitted_at
  )
  VALUES (
    p_document_type, p_business_id, p_business_version, v_creator, v_creator,
    v_creator_org, v_project_id, p_business_type, 'in_approval', now()
  )
  ON CONFLICT (document_type, business_id, business_version) DO UPDATE
  SET lifecycle_status = 'in_approval',
      submitted_at = COALESCE(public.business_documents.submitted_at, now()),
      updated_at = now()
  RETURNING id INTO v_doc_id;

  SELECT id INTO v_instance_id
  FROM public.approval_instances
  WHERE document_id = v_doc_id
  LIMIT 1;

  IF v_instance_id IS NULL THEN
    SELECT id INTO v_instance_id
    FROM public.approval_instances
    WHERE target_type = p_document_type
      AND target_id = p_business_id
    LIMIT 1;

    IF v_instance_id IS NOT NULL THEN
      UPDATE public.approval_instances
      SET document_id = v_doc_id,
          template_id = v_template.id,
          template_version = v_template.version,
          template_snapshot = public.psa_template_snapshot(v_template.id),
          status = 'running',
          updated_at = now()
      WHERE id = v_instance_id;
    END IF;
  END IF;

  IF v_instance_id IS NOT NULL THEN
    SELECT current_round_id INTO v_round_id
    FROM public.approval_instances
    WHERE id = v_instance_id;
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

  UPDATE public.approval_instances
  SET current_round_id = v_round_id, current_round = 1, updated_at = now()
  WHERE id = v_instance_id;

  FOR v_node IN
    SELECT *
    FROM public.approval_template_nodes
    WHERE template_id = v_template.id
    ORDER BY sort_order, node_key
  LOOP
    INSERT INTO public.approval_nodes (
      round_id, instance_id, node_key, template_node_key, node_name, node_type,
      scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
      reject_policy, snapshot, metadata
    )
    VALUES (
      v_round_id, v_instance_id, v_node.node_key, v_node.node_key, v_node.node_name, v_node.node_type,
      CASE WHEN p_document_type = 'timesheet' AND v_node.node_key = 'department_summary' THEN 'department_summary' ELSE p_document_type END,
      NULL,
      'waiting', v_node.resolver_type, v_node.resolver_role, v_node.approval_policy,
      v_node.reject_policy, to_jsonb(v_node), to_jsonb(v_node)
    )
    RETURNING id INTO v_new_node_id;
  END LOOP;

  IF p_document_type = 'timesheet' THEN
    DELETE FROM public.approval_nodes
    WHERE round_id = v_round_id AND node_key = 'project_review';

    FOR v_node IN
      SELECT project_id, assignee_user_id, assignee_role
      FROM public.psa_resolve_timesheet_project_assignees(p_business_id)
    LOOP
      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, snapshot, metadata
      )
      VALUES (
        v_round_id, v_instance_id, 'project_review_' || v_node.project_id, 'project_review',
        'Project Review', 'approval', 'project', v_node.project_id, 'waiting',
        'project_role', 'project_owner', 'single', 'back_to_creator',
        jsonb_build_object('resolved_assignee_user_id', v_node.assignee_user_id, 'assignee_role', v_node.assignee_role),
        jsonb_build_object('project_id', v_node.project_id)
      );
    END LOOP;

    INSERT INTO public.approval_edges (round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type)
    SELECT v_round_id, v_instance_id, project_node.id, summary_node.id, 'normal', 'all_approved'
    FROM public.approval_nodes project_node
    JOIN public.approval_nodes summary_node
      ON summary_node.round_id = v_round_id AND summary_node.node_key = 'department_summary'
    WHERE project_node.round_id = v_round_id
      AND project_node.template_node_key = 'project_review';
  END IF;

  FOR v_node IN
    SELECT e.*
    FROM public.approval_template_edges e
    WHERE e.template_id = v_template.id
      AND NOT (p_document_type = 'timesheet' AND e.from_node_key = 'project_review')
  LOOP
    SELECT id INTO v_from_id FROM public.approval_nodes WHERE round_id = v_round_id AND node_key = v_node.from_node_key LIMIT 1;
    SELECT id INTO v_to_id FROM public.approval_nodes WHERE round_id = v_round_id AND node_key = v_node.to_node_key LIMIT 1;
    IF v_from_id IS NOT NULL AND v_to_id IS NOT NULL THEN
      INSERT INTO public.approval_edges (round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type, condition_expr)
      VALUES (v_round_id, v_instance_id, v_from_id, v_to_id, v_node.edge_type, v_node.edge_type, v_node.condition_expr)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  PERFORM public.psa_activate_ready_nodes(v_round_id);
  PERFORM public.psa_write_approval_event(
    v_instance_id, v_round_id, NULL, NULL, v_creator, 'document_submitted',
    'draft', 'in_approval', p_request_id, '', p_context
  );

  submit_document.document_id := v_doc_id;
  submit_document.instance_id := v_instance_id;
  submit_document.round_id := v_round_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_node(
  p_node_id bigint,
  p_actor_user_id bigint DEFAULT NULL,
  p_comment text DEFAULT '',
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor bigint := COALESCE(p_actor_user_id, public.current_employee_id());
  v_node public.approval_nodes%rowtype;
  v_assignee public.approval_node_assignees%rowtype;
  v_pending_count int;
  v_terminal_unapproved int;
BEGIN
  SELECT * INTO v_node FROM public.approval_nodes WHERE id = p_node_id FOR UPDATE;
  IF v_node.id IS NULL OR v_node.status <> 'active' THEN
    RAISE EXCEPTION 'Node is not active';
  END IF;

  SELECT * INTO v_assignee
  FROM public.approval_node_assignees
  WHERE node_id = p_node_id AND assignee_user_id = v_actor AND status = 'pending'
  FOR UPDATE;
  IF v_assignee.id IS NULL THEN
    RAISE EXCEPTION 'Actor is not a pending assignee for this node';
  END IF;

  UPDATE public.approval_node_assignees
  SET status = 'approved', action = 'approve', comment = COALESCE(p_comment, ''), acted_at = now()
  WHERE id = v_assignee.id AND status = 'pending';

  PERFORM public.psa_write_approval_event(
    v_node.instance_id, v_node.round_id, v_node.id, v_assignee.id, v_actor,
    'assignee_approved', 'pending', 'approved', p_request_id, p_comment, '{}'::jsonb
  );

  IF v_node.approval_policy IN ('single', 'any') THEN
    UPDATE public.approval_node_assignees
    SET status = 'cancelled', action = 'cancelled', acted_at = now()
    WHERE node_id = p_node_id AND status = 'pending';
    v_pending_count := 0;
  ELSE
    SELECT count(*) INTO v_pending_count
    FROM public.approval_node_assignees
    WHERE node_id = p_node_id AND status = 'pending';
  END IF;

  IF v_pending_count = 0 THEN
    UPDATE public.approval_nodes
    SET status = 'approved', result_action = 'approve', comment = COALESCE(p_comment, ''),
        completed_at = now(), updated_at = now()
    WHERE id = p_node_id AND status = 'active';

    PERFORM public.psa_activate_ready_nodes(v_node.round_id);
  END IF;

  SELECT count(*) INTO v_terminal_unapproved
  FROM public.approval_nodes n
  WHERE n.round_id = v_node.round_id
    AND NOT EXISTS (
      SELECT 1 FROM public.approval_edges e
      WHERE e.round_id = v_node.round_id
        AND e.from_node_id = n.id
        AND e.condition_result = true
    )
    AND n.status NOT IN ('approved', 'skipped');

  IF v_terminal_unapproved = 0 THEN
    UPDATE public.approval_rounds
    SET status = 'approved', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_node.round_id AND status = 'running';

    UPDATE public.approval_instances
    SET status = 'approved', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE id = v_node.instance_id AND status = 'running';

    UPDATE public.business_documents d
    SET lifecycle_status = 'approved', approved_at = COALESCE(approved_at, now()), updated_at = now()
    FROM public.approval_instances i
    WHERE i.id = v_node.instance_id AND d.id = i.document_id;

    UPDATE public.timesheets t
    SET status = 'approved', approved_by = v_actor, approved_at = now(), updated_at = now()
    FROM public.approval_instances i
    WHERE i.id = v_node.instance_id
      AND i.target_type = 'timesheet'
      AND t.id = i.target_id;

    PERFORM public.psa_write_approval_event(
      v_node.instance_id, v_node.round_id, NULL, NULL, v_actor,
      'document_approved', 'in_approval', 'approved', NULL, '', '{}'::jsonb
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'node_id', p_node_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_node(
  p_node_id bigint,
  p_actor_user_id bigint DEFAULT NULL,
  p_reject_policy text DEFAULT 'back_to_creator',
  p_target_node_key text DEFAULT NULL,
  p_comment text DEFAULT '',
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor bigint := COALESCE(p_actor_user_id, public.current_employee_id());
  v_node public.approval_nodes%rowtype;
  v_assignee public.approval_node_assignees%rowtype;
BEGIN
  SELECT * INTO v_node FROM public.approval_nodes WHERE id = p_node_id FOR UPDATE;
  IF v_node.id IS NULL OR v_node.status <> 'active' THEN
    RAISE EXCEPTION 'Node is not active';
  END IF;

  SELECT * INTO v_assignee
  FROM public.approval_node_assignees
  WHERE node_id = p_node_id AND assignee_user_id = v_actor AND status = 'pending'
  FOR UPDATE;
  IF v_assignee.id IS NULL THEN
    RAISE EXCEPTION 'Actor is not a pending assignee for this node';
  END IF;

  UPDATE public.approval_node_assignees
  SET status = 'rejected', action = 'reject', comment = COALESCE(p_comment, ''), acted_at = now()
  WHERE id = v_assignee.id AND status = 'pending';

  UPDATE public.approval_node_assignees
  SET status = 'cancelled', action = 'cancelled', acted_at = now()
  WHERE node_id = p_node_id AND status = 'pending';

  UPDATE public.approval_nodes
  SET status = 'rejected', result_action = 'reject', comment = COALESCE(p_comment, ''),
      completed_at = now(), updated_at = now()
  WHERE id = p_node_id AND status = 'active';

  UPDATE public.approval_rounds
  SET status = 'revision_required', updated_at = now()
  WHERE id = v_node.round_id;

  UPDATE public.approval_instances
  SET status = 'revision_required', updated_at = now()
  WHERE id = v_node.instance_id;

  UPDATE public.business_documents d
  SET lifecycle_status = 'revision_required', updated_at = now()
  FROM public.approval_instances i
  WHERE i.id = v_node.instance_id AND d.id = i.document_id;

  UPDATE public.timesheets t
  SET status = 'revision_required', review_comment = COALESCE(p_comment, ''), updated_at = now()
  FROM public.approval_instances i
  WHERE i.id = v_node.instance_id
    AND i.target_type = 'timesheet'
    AND t.id = i.target_id;

  PERFORM public.psa_write_approval_event(
    v_node.instance_id, v_node.round_id, v_node.id, v_assignee.id, v_actor,
    'assignee_rejected', 'pending', 'rejected', p_request_id, p_comment,
    jsonb_build_object('reject_policy', p_reject_policy, 'target_node_key', p_target_node_key)
  );

  RETURN jsonb_build_object('ok', true, 'node_id', p_node_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.revise_document(
  p_document_id bigint,
  p_business_version int,
  p_actor_user_id bigint DEFAULT NULL,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_request_id text DEFAULT NULL
)
RETURNS TABLE(document_id bigint, instance_id bigint, round_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_doc public.business_documents%rowtype;
BEGIN
  SELECT * INTO v_doc FROM public.business_documents WHERE id = p_document_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;
  IF v_doc.lifecycle_status <> 'revision_required' THEN
    RAISE EXCEPTION 'Document is not waiting revision';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.submit_document(
    v_doc.document_type,
    v_doc.business_id,
    p_business_version,
    v_doc.business_type,
    COALESCE(p_actor_user_id, v_doc.creator_user_id),
    p_context,
    p_request_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_document(
  p_document_id bigint,
  p_actor_user_id bigint DEFAULT NULL,
  p_context jsonb DEFAULT '{}'::jsonb,
  p_request_id text DEFAULT NULL
)
RETURNS TABLE(document_id bigint, instance_id bigint, round_id bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT *
  FROM public.revise_document(
    p_document_id,
    (SELECT business_version + 1 FROM public.business_documents WHERE id = p_document_id),
    p_actor_user_id,
    p_context,
    p_request_id
  );
$$;

CREATE OR REPLACE FUNCTION public.delegate_node(
  p_node_id bigint,
  p_actor_user_id bigint,
  p_delegate_user_id bigint,
  p_comment text DEFAULT '',
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_node public.approval_nodes%rowtype;
  v_assignee public.approval_node_assignees%rowtype;
BEGIN
  SELECT * INTO v_node FROM public.approval_nodes WHERE id = p_node_id;
  IF v_node.id IS NULL OR v_node.status <> 'active' THEN
    RAISE EXCEPTION 'Node is not active';
  END IF;

  SELECT * INTO v_assignee
  FROM public.approval_node_assignees
  WHERE node_id = p_node_id AND assignee_user_id = p_actor_user_id AND status = 'pending'
  FOR UPDATE;
  IF v_assignee.id IS NULL THEN
    RAISE EXCEPTION 'Actor is not a pending assignee for this node';
  END IF;

  UPDATE public.approval_node_assignees
  SET status = 'delegated', action = 'delegate', comment = COALESCE(p_comment, ''), acted_at = now()
  WHERE id = v_assignee.id;

  INSERT INTO public.approval_node_assignees(node_id, assignee_user_id, assignee_employee_id, status)
  VALUES (p_node_id, p_delegate_user_id, p_delegate_user_id, 'pending')
  ON CONFLICT (node_id, assignee_user_id) DO UPDATE SET status = 'pending';

  PERFORM public.psa_write_approval_event(
    v_node.instance_id, v_node.round_id, v_node.id, v_assignee.id, p_actor_user_id,
    'assignee_delegated', 'pending', 'delegated', p_request_id, p_comment,
    jsonb_build_object('delegate_user_id', p_delegate_user_id)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.skip_node(
  p_node_id bigint,
  p_actor_user_id bigint DEFAULT NULL,
  p_comment text DEFAULT '',
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor bigint := COALESCE(p_actor_user_id, public.current_employee_id());
  v_node public.approval_nodes%rowtype;
BEGIN
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only admin can skip approval nodes';
  END IF;

  SELECT * INTO v_node FROM public.approval_nodes WHERE id = p_node_id FOR UPDATE;
  IF v_node.id IS NULL OR v_node.status NOT IN ('active', 'waiting', 'pending') THEN
    RAISE EXCEPTION 'Node cannot be skipped';
  END IF;

  UPDATE public.approval_nodes
  SET status = 'skipped', result_action = 'skip', comment = COALESCE(p_comment, ''),
      completed_at = now(), updated_at = now()
  WHERE id = p_node_id;

  UPDATE public.approval_node_assignees
  SET status = 'skipped', action = 'skip', comment = COALESCE(p_comment, ''), acted_at = now()
  WHERE node_id = p_node_id AND status = 'pending';

  PERFORM public.psa_write_approval_event(
    v_node.instance_id, v_node.round_id, v_node.id, NULL, v_actor,
    'node_skipped', v_node.status, 'skipped', p_request_id, p_comment, '{}'::jsonb
  );

  PERFORM public.psa_activate_ready_nodes(v_node.round_id);
  RETURN jsonb_build_object('ok', true);
END;
$$;

INSERT INTO public.approval_templates(template_key, document_type, business_type, name, version, status)
VALUES ('timesheet_parallel_v1', 'timesheet', NULL, 'Timesheet Parallel Project Review', 1, 'active')
ON CONFLICT (template_key) DO UPDATE
SET document_type = EXCLUDED.document_type,
    business_type = EXCLUDED.business_type,
    name = EXCLUDED.name,
    version = EXCLUDED.version,
    status = EXCLUDED.status;

WITH t AS (
  SELECT id FROM public.approval_templates WHERE template_key = 'timesheet_parallel_v1'
)
INSERT INTO public.approval_template_nodes(
  template_id, node_key, node_name, node_type, resolver_type, resolver_role,
  approval_policy, reject_policy, sort_order
)
SELECT t.id, v.node_key, v.node_name, v.node_type, v.resolver_type, v.resolver_role,
       v.approval_policy, v.reject_policy, v.sort_order
FROM t
CROSS JOIN (VALUES
  ('project_review', 'Project Review', 'approval', 'project_role', 'project_owner', 'single', 'back_to_creator', 10),
  ('department_summary', 'Department Summary Review', 'approval', 'org_manager', 'department_head', 'single', 'back_to_creator', 20)
) AS v(node_key, node_name, node_type, resolver_type, resolver_role, approval_policy, reject_policy, sort_order)
ON CONFLICT (template_id, node_key) DO UPDATE
SET node_name = EXCLUDED.node_name,
    node_type = EXCLUDED.node_type,
    resolver_type = EXCLUDED.resolver_type,
    resolver_role = EXCLUDED.resolver_role,
    approval_policy = EXCLUDED.approval_policy,
    reject_policy = EXCLUDED.reject_policy,
    sort_order = EXCLUDED.sort_order;

CREATE OR REPLACE FUNCTION public.psa_timesheet_action(
  p_timesheet_id bigint,
  p_action text,
  p_comment text DEFAULT '',
  p_task_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor bigint := public.current_employee_id();
  v_sheet public.timesheets%rowtype;
  v_node_id bigint;
  v_request_id text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_sheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
  IF v_sheet.id IS NULL THEN
    RAISE EXCEPTION 'Timesheet not found';
  END IF;

  v_request_id := 'timesheet:' || p_timesheet_id || ':' || p_action || ':' || COALESCE(p_task_id::text, 'submit') || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::text;

  IF p_action = 'submit' THEN
    UPDATE public.timesheets
    SET status = 'submitted',
        submitted_at = COALESCE(submitted_at, now()),
        updated_at = now()
    WHERE id = p_timesheet_id
      AND status IN ('draft', 'rejected', 'revision_required', 'submitted');

    PERFORM 1
    FROM public.submit_document(
      'timesheet',
      p_timesheet_id,
      1,
      NULL,
      v_sheet.user_id,
      jsonb_build_object('source', 'psa_timesheet_action'),
      v_request_id
    );

    RETURN jsonb_build_object('ok', true, 'action', p_action);
  END IF;

  IF p_task_id IS NOT NULL THEN
    SELECT n.id INTO v_node_id
    FROM public.approval_nodes n
    WHERE n.source_task_id = p_task_id
    ORDER BY n.id DESC
    LIMIT 1;
  END IF;

  IF v_node_id IS NULL THEN
    SELECT n.id INTO v_node_id
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    JOIN public.approval_node_assignees a ON a.node_id = n.id
    WHERE i.target_type = 'timesheet'
      AND i.target_id = p_timesheet_id
      AND n.status = 'active'
      AND a.status = 'pending'
      AND a.assignee_user_id = v_actor
    ORDER BY n.id
    LIMIT 1;
  END IF;

  IF v_node_id IS NULL THEN
    RAISE EXCEPTION 'No active approval node found for current user';
  END IF;

  IF p_action = 'approve' THEN
    v_result := public.approve_node(v_node_id, v_actor, p_comment, v_request_id);
  ELSIF p_action = 'reject' THEN
    v_result := public.reject_node(v_node_id, v_actor, 'back_to_creator', NULL, p_comment, v_request_id);
  ELSE
    RAISE EXCEPTION 'Unsupported timesheet action %', p_action;
  END IF;

  RETURN v_result;
END;
$$;

DROP VIEW IF EXISTS public.approval_project_review_records_view;
DROP VIEW IF EXISTS public.approval_reviewed_timesheets_view;
DROP VIEW IF EXISTS public.approval_pending_tasks_view;

CREATE VIEW public.approval_pending_tasks_view AS
SELECT
  n.id,
  n.id AS task_id,
  i.target_type,
  i.target_id,
  n.scope_type,
  n.scope_id,
  n.assignee_role,
  a.assignee_user_id,
  n.activated_at AS created_at,
  'pending'::text AS status,
  NULL::text AS result_action,
  NULL::timestamptz AS completed_at,
  n.comment,
  n.node_name,
  d.document_type,
  d.business_id,
  d.creator_user_id
FROM public.approval_nodes n
JOIN public.approval_instances i ON i.id = n.instance_id
JOIN public.business_documents d ON d.id = i.document_id
JOIN public.approval_node_assignees a ON a.node_id = n.id
WHERE n.status = 'active'
  AND a.status = 'pending';

CREATE VIEW public.approval_reviewed_timesheets_view AS
SELECT
  n.id,
  n.id AS task_id,
  i.target_type,
  i.target_id,
  i.target_id AS timesheet_id,
  n.scope_type,
  n.scope_id,
  n.assignee_role,
  a.assignee_user_id,
  a.action AS result_action,
  a.comment,
  a.acted_at AS completed_at
FROM public.approval_node_assignees a
JOIN public.approval_nodes n ON n.id = a.node_id
JOIN public.approval_instances i ON i.id = n.instance_id
WHERE i.target_type = 'timesheet'
  AND a.status IN ('approved', 'rejected', 'delegated', 'skipped');

CREATE VIEW public.approval_project_review_records_view AS
SELECT
  i.target_id AS timesheet_id,
  n.scope_id AS project_id,
  CASE
    WHEN n.status = 'approved' THEN 'project_approved'
    WHEN n.status = 'rejected' THEN 'needs_revision'
    WHEN n.status = 'skipped' THEN 'project_approved'
    ELSE 'pending'
  END AS status,
  COALESCE(n.snapshot ->> 'route_source', n.assignee_role, n.resolver_role) AS route_source,
  n.completed_at AS project_approved_at,
  NULL::timestamptz AS final_confirmed_at,
  COALESCE(n.completed_at, n.activated_at, n.created_at) AS last_action_at,
  n.result_action,
  n.comment
FROM public.approval_nodes n
JOIN public.approval_instances i ON i.id = n.instance_id
WHERE i.target_type = 'timesheet'
  AND n.scope_type = 'project'
  AND n.scope_id IS NOT NULL;

ALTER TABLE public.business_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_template_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_template_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_node_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read business documents" ON public.business_documents;
CREATE POLICY "Authenticated read business documents" ON public.business_documents FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read approval templates" ON public.approval_templates;
CREATE POLICY "Authenticated read approval templates" ON public.approval_templates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read approval template nodes" ON public.approval_template_nodes;
CREATE POLICY "Authenticated read approval template nodes" ON public.approval_template_nodes FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read approval template edges" ON public.approval_template_edges;
CREATE POLICY "Authenticated read approval template edges" ON public.approval_template_edges FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read approval assignees" ON public.approval_node_assignees;
CREATE POLICY "Authenticated read approval assignees" ON public.approval_node_assignees FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admin manage project roles" ON public.project_roles;
CREATE POLICY "Admin manage project roles" ON public.project_roles FOR ALL TO authenticated
USING (public.current_user_has_role('admin')) WITH CHECK (public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "Authenticated read project roles" ON public.project_roles;
CREATE POLICY "Authenticated read project roles" ON public.project_roles FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.business_documents TO authenticated;
GRANT SELECT ON public.approval_templates TO authenticated;
GRANT SELECT ON public.approval_template_nodes TO authenticated;
GRANT SELECT ON public.approval_template_edges TO authenticated;
GRANT SELECT ON public.approval_node_assignees TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.project_roles TO authenticated;
GRANT SELECT ON public.approval_pending_tasks_view TO authenticated;
GRANT SELECT ON public.approval_reviewed_timesheets_view TO authenticated;
GRANT SELECT ON public.approval_project_review_records_view TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.business_documents_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.approval_templates_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.approval_template_nodes_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.approval_template_edges_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.approval_node_assignees_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.project_roles_id_seq TO authenticated;

ALTER FUNCTION public.psa_template_snapshot(bigint) OWNER TO postgres;
ALTER FUNCTION public.psa_resolve_graph_assignees(bigint, text, text, bigint) OWNER TO postgres;
ALTER FUNCTION public.psa_write_approval_event(bigint, bigint, bigint, bigint, bigint, text, text, text, text, text, jsonb) OWNER TO postgres;
ALTER FUNCTION public.psa_activate_ready_nodes(bigint) OWNER TO postgres;
ALTER FUNCTION public.submit_document(text, bigint, int, text, bigint, jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.approve_node(bigint, bigint, text, text) OWNER TO postgres;
ALTER FUNCTION public.reject_node(bigint, bigint, text, text, text, text) OWNER TO postgres;
ALTER FUNCTION public.revise_document(bigint, int, bigint, jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.reopen_document(bigint, bigint, jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.delegate_node(bigint, bigint, bigint, text, text) OWNER TO postgres;
ALTER FUNCTION public.skip_node(bigint, bigint, text, text) OWNER TO postgres;
ALTER FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.submit_document(text, bigint, int, text, bigint, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_node(bigint, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_node(bigint, bigint, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revise_document(bigint, int, bigint, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_document(bigint, bigint, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delegate_node(bigint, bigint, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skip_node(bigint, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
