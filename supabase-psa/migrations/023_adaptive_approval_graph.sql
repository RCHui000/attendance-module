-- V0.12.8: Add Adaptive Approval Graph read model for timesheet approvals.

BEGIN;

CREATE TABLE IF NOT EXISTS public.approval_instances (
  id BIGSERIAL PRIMARY KEY,
  approval_key TEXT NOT NULL DEFAULT 'timesheet',
  target_type TEXT NOT NULL,
  target_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  current_round_id BIGINT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE(target_type, target_id)
);

CREATE TABLE IF NOT EXISTS public.approval_rounds (
  id BIGSERIAL PRIMARY KEY,
  instance_id BIGINT NOT NULL REFERENCES public.approval_instances(id) ON DELETE CASCADE,
  round_no INT NOT NULL,
  round_type TEXT NOT NULL DEFAULT 'initial_submit',
  status TEXT NOT NULL DEFAULT 'running',
  based_on_round_id BIGINT REFERENCES public.approval_rounds(id),
  started_by BIGINT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(instance_id, round_no)
);

ALTER TABLE public.approval_instances
  DROP CONSTRAINT IF EXISTS approval_instances_current_round_id_fkey;

ALTER TABLE public.approval_instances
  ADD CONSTRAINT approval_instances_current_round_id_fkey
  FOREIGN KEY (current_round_id) REFERENCES public.approval_rounds(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.approval_nodes (
  id BIGSERIAL PRIMARY KEY,
  round_id BIGINT NOT NULL REFERENCES public.approval_rounds(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'timesheet',
  scope_id BIGINT,
  status TEXT NOT NULL DEFAULT 'waiting',
  assignee_user_id BIGINT,
  assignee_role TEXT,
  source_task_id BIGINT,
  activated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result_action TEXT,
  comment TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(round_id, node_key)
);

CREATE TABLE IF NOT EXISTS public.approval_edges (
  id BIGSERIAL PRIMARY KEY,
  round_id BIGINT NOT NULL REFERENCES public.approval_rounds(id) ON DELETE CASCADE,
  from_node_id BIGINT NOT NULL REFERENCES public.approval_nodes(id) ON DELETE CASCADE,
  to_node_id BIGINT NOT NULL REFERENCES public.approval_nodes(id) ON DELETE CASCADE,
  condition_type TEXT NOT NULL DEFAULT 'all_approved',
  condition_expr JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(round_id, from_node_id, to_node_id, condition_type)
);

CREATE TABLE IF NOT EXISTS public.approval_events (
  id BIGSERIAL PRIMARY KEY,
  instance_id BIGINT NOT NULL REFERENCES public.approval_instances(id) ON DELETE CASCADE,
  round_id BIGINT REFERENCES public.approval_rounds(id) ON DELETE SET NULL,
  node_id BIGINT REFERENCES public.approval_nodes(id) ON DELETE SET NULL,
  actor_id BIGINT,
  event_type TEXT NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_instances_target
  ON public.approval_instances(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_approval_rounds_instance
  ON public.approval_rounds(instance_id, round_no DESC);

CREATE INDEX IF NOT EXISTS idx_approval_nodes_round_status
  ON public.approval_nodes(round_id, status, node_type);

CREATE INDEX IF NOT EXISTS idx_approval_nodes_scope
  ON public.approval_nodes(scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_approval_nodes_source_task
  ON public.approval_nodes(source_task_id);

CREATE INDEX IF NOT EXISTS idx_approval_events_instance
  ON public.approval_events(instance_id, created_at DESC);

ALTER TABLE public.approval_instances
  DROP CONSTRAINT IF EXISTS chk_approval_instances_status;
ALTER TABLE public.approval_instances
  ADD CONSTRAINT chk_approval_instances_status
  CHECK (status IN ('running', 'revision_required', 'approved', 'cancelled'));

ALTER TABLE public.approval_rounds
  DROP CONSTRAINT IF EXISTS chk_approval_rounds_round_no;
ALTER TABLE public.approval_rounds
  ADD CONSTRAINT chk_approval_rounds_round_no
  CHECK (round_no > 0);

ALTER TABLE public.approval_rounds
  DROP CONSTRAINT IF EXISTS chk_approval_rounds_status;
ALTER TABLE public.approval_rounds
  ADD CONSTRAINT chk_approval_rounds_status
  CHECK (status IN ('running', 'revision_required', 'approved', 'cancelled'));

ALTER TABLE public.approval_rounds
  DROP CONSTRAINT IF EXISTS chk_approval_rounds_type;
ALTER TABLE public.approval_rounds
  ADD CONSTRAINT chk_approval_rounds_type
  CHECK (round_type IN ('initial_submit', 'revision_submit', 'reopened_revision', 'backfill'));

ALTER TABLE public.approval_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_nodes_status;
ALTER TABLE public.approval_nodes
  ADD CONSTRAINT chk_approval_nodes_status
  CHECK (status IN ('waiting', 'pending', 'approved', 'needs_revision', 'needs_reapproval', 'cancelled', 'skipped'));

ALTER TABLE public.approval_nodes
  DROP CONSTRAINT IF EXISTS chk_approval_nodes_scope;
ALTER TABLE public.approval_nodes
  ADD CONSTRAINT chk_approval_nodes_scope
  CHECK (
    (scope_type = 'project' AND scope_id IS NOT NULL)
    OR (scope_type IN ('timesheet', 'department_summary') AND scope_id IS NULL)
  );

ALTER TABLE public.approval_edges
  DROP CONSTRAINT IF EXISTS chk_approval_edges_no_self_loop;
ALTER TABLE public.approval_edges
  ADD CONSTRAINT chk_approval_edges_no_self_loop
  CHECK (from_node_id <> to_node_id);

ALTER TABLE public.approval_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read approval instances" ON public.approval_instances;
CREATE POLICY "Authenticated read approval instances"
  ON public.approval_instances FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin manage approval instances" ON public.approval_instances;
CREATE POLICY "Admin manage approval instances"
  ON public.approval_instances FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "Authenticated read approval rounds" ON public.approval_rounds;
CREATE POLICY "Authenticated read approval rounds"
  ON public.approval_rounds FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin manage approval rounds" ON public.approval_rounds;
CREATE POLICY "Admin manage approval rounds"
  ON public.approval_rounds FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "Authenticated read approval nodes" ON public.approval_nodes;
CREATE POLICY "Authenticated read approval nodes"
  ON public.approval_nodes FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin manage approval nodes" ON public.approval_nodes;
CREATE POLICY "Admin manage approval nodes"
  ON public.approval_nodes FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "Authenticated read approval edges" ON public.approval_edges;
CREATE POLICY "Authenticated read approval edges"
  ON public.approval_edges FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin manage approval edges" ON public.approval_edges;
CREATE POLICY "Admin manage approval edges"
  ON public.approval_edges FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

DROP POLICY IF EXISTS "Authenticated read approval events" ON public.approval_events;
CREATE POLICY "Authenticated read approval events"
  ON public.approval_events FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin manage approval events" ON public.approval_events;
CREATE POLICY "Admin manage approval events"
  ON public.approval_events FOR ALL TO authenticated
  USING (public.current_user_has_role('admin'))
  WITH CHECK (public.current_user_has_role('admin'));

CREATE OR REPLACE FUNCTION public.psa_approval_instance_status(p_timesheet_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_timesheet_status = 'approved' THEN 'approved'
    WHEN p_timesheet_status IN ('rejected', 'draft') THEN 'revision_required'
    WHEN p_timesheet_status = 'submitted' THEN 'running'
    ELSE COALESCE(NULLIF(p_timesheet_status, ''), 'running')
  END
$$;

CREATE OR REPLACE FUNCTION public.psa_ensure_timesheet_approval_round(
  p_timesheet_id bigint,
  p_actor_id bigint DEFAULT NULL,
  p_event_type text DEFAULT 'sync',
  p_comment text DEFAULT ''
)
RETURNS TABLE(instance_id bigint, round_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sheet public.timesheets%rowtype;
  v_instance_id bigint;
  v_round_id bigint;
  v_next_round_no int;
  v_round_type text;
  v_actor_id bigint;
  v_instance_status text;
  v_round_status text;
BEGIN
  SELECT *
    INTO v_sheet
    FROM public.timesheets
    WHERE id = p_timesheet_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_actor_id := COALESCE(p_actor_id, public.current_employee_id(), v_sheet.user_id);
  v_instance_status := public.psa_approval_instance_status(v_sheet.status);
  v_round_status := CASE
    WHEN v_sheet.status = 'approved' THEN 'approved'
    WHEN v_sheet.status IN ('draft', 'rejected') THEN 'revision_required'
    ELSE 'running'
  END;

  INSERT INTO public.approval_instances (
    approval_key, target_type, target_id, status, created_by, completed_at
  )
  VALUES (
    'timesheet',
    'timesheet',
    p_timesheet_id,
    v_instance_status,
    v_actor_id,
    CASE WHEN v_sheet.status = 'approved' THEN COALESCE(v_sheet.approved_at, now()) ELSE NULL END
  )
  ON CONFLICT (target_type, target_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    updated_at = now(),
    completed_at = CASE
      WHEN EXCLUDED.status = 'approved' THEN COALESCE(public.approval_instances.completed_at, EXCLUDED.completed_at, now())
      ELSE NULL
    END
  RETURNING id INTO v_instance_id;

  SELECT r.id
    INTO v_round_id
    FROM public.approval_rounds r
    JOIN public.approval_instances i ON i.current_round_id = r.id
    WHERE i.id = v_instance_id
      AND r.status = 'running'
    ORDER BY r.round_no DESC
    LIMIT 1;

  IF v_round_id IS NULL THEN
    SELECT COALESCE(MAX(round_no), 0) + 1
      INTO v_next_round_no
      FROM public.approval_rounds ar
      WHERE ar.instance_id = v_instance_id;

    v_round_type := CASE
      WHEN p_event_type = 'backfill' THEN 'backfill'
      WHEN v_next_round_no = 1 THEN 'initial_submit'
      WHEN p_event_type = 'reopen' THEN 'reopened_revision'
      ELSE 'revision_submit'
    END;

    INSERT INTO public.approval_rounds (
      instance_id, round_no, round_type, status, based_on_round_id, started_by
    )
    VALUES (
      v_instance_id,
      v_next_round_no,
      v_round_type,
      v_round_status,
      (
        SELECT id
        FROM public.approval_rounds ar
        WHERE ar.instance_id = v_instance_id
        ORDER BY round_no DESC
        LIMIT 1
      ),
      v_actor_id
    )
    RETURNING id INTO v_round_id;

    UPDATE public.approval_instances
       SET current_round_id = v_round_id,
           updated_at = now()
     WHERE id = v_instance_id;
  ELSE
    UPDATE public.approval_rounds
       SET status = v_round_status,
           updated_at = now(),
           completed_at = CASE
             WHEN v_round_status = 'approved' THEN COALESCE(completed_at, v_sheet.approved_at, now())
             WHEN v_round_status = 'running' THEN NULL
             ELSE completed_at
           END
     WHERE id = v_round_id;
  END IF;

  psa_ensure_timesheet_approval_round.instance_id := v_instance_id;
  psa_ensure_timesheet_approval_round.round_id := v_round_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_sync_timesheet_approval_graph(
  p_timesheet_id bigint,
  p_event_type text DEFAULT 'sync',
  p_comment text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sheet public.timesheets%rowtype;
  v_actor_id bigint;
  v_instance_id bigint;
  v_round_id bigint;
  v_project_node_count integer := 0;
  v_summary_node_count integer := 0;
  v_edge_count integer := 0;
BEGIN
  SELECT *
    INTO v_sheet
    FROM public.timesheets
    WHERE id = p_timesheet_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'timesheet not found');
  END IF;

  v_actor_id := COALESCE(public.current_employee_id(), v_sheet.user_id);

  SELECT r.instance_id, r.round_id
    INTO v_instance_id, v_round_id
    FROM public.psa_ensure_timesheet_approval_round(p_timesheet_id, v_actor_id, p_event_type, p_comment) r
    LIMIT 1;

  IF v_instance_id IS NULL OR v_round_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'round not available');
  END IF;

  WITH project_scopes AS (
    SELECT DISTINCT te.project_id
    FROM public.timesheet_entries te
    WHERE te.timesheet_id = p_timesheet_id
      AND te.project_id IS NOT NULL
  ),
  resolver AS (
    SELECT *
    FROM public.psa_resolve_timesheet_project_assignees(p_timesheet_id)
  ),
  task_rank AS (
    SELECT
      wt.*,
      ROW_NUMBER() OVER (
        PARTITION BY wt.scope_type, COALESCE(wt.scope_id, 0)
        ORDER BY
          CASE WHEN wt.status = 'pending' THEN 0 ELSE 1 END,
          COALESCE(wt.completed_at, wt.created_at) DESC,
          wt.id DESC
      ) AS rn
    FROM public.workflow_tasks wt
    WHERE wt.workflow_key = 'timesheet'
      AND wt.target_type = 'timesheet'
      AND wt.target_id = p_timesheet_id
      AND wt.scope_type = 'project'
  ),
  node_rows AS (
    SELECT
      ps.project_id,
      COALESCE(t.assignee_user_id, resolver.assignee_user_id) AS assignee_user_id,
      COALESCE(t.assignee_role, resolver.assignee_role, 'project_owner') AS assignee_role,
      t.id AS source_task_id,
      CASE
        WHEN t.status = 'pending' THEN 'pending'
        WHEN t.status = 'completed' AND t.result_action = 'approve' THEN 'approved'
        WHEN t.status = 'completed' AND t.result_action = 'reject' THEN 'needs_revision'
        WHEN t.status = 'completed' AND t.result_action IN ('cancelled', 'superseded') THEN 'cancelled'
        WHEN v_sheet.status = 'approved' THEN 'approved'
        WHEN v_sheet.status = 'rejected' THEN 'needs_revision'
        ELSE 'waiting'
      END AS node_status,
      t.created_at AS activated_at,
      t.completed_at,
      t.result_action,
      COALESCE(t.comment, '') AS comment
    FROM project_scopes ps
    LEFT JOIN resolver ON resolver.project_id = ps.project_id
    LEFT JOIN task_rank t ON t.scope_id = ps.project_id AND t.rn = 1
  ),
  upserted AS (
    INSERT INTO public.approval_nodes (
      round_id, node_key, node_type, scope_type, scope_id, status,
      assignee_user_id, assignee_role, source_task_id, activated_at,
      completed_at, result_action, comment, updated_at
    )
    SELECT
      v_round_id,
      'project:' || project_id::text,
      'project_review',
      'project',
      project_id,
      node_status,
      assignee_user_id,
      assignee_role,
      source_task_id,
      COALESCE(activated_at, now()),
      completed_at,
      result_action,
      comment,
      now()
    FROM node_rows
    ON CONFLICT (round_id, node_key)
    DO UPDATE SET
      status = EXCLUDED.status,
      assignee_user_id = EXCLUDED.assignee_user_id,
      assignee_role = EXCLUDED.assignee_role,
      source_task_id = EXCLUDED.source_task_id,
      activated_at = COALESCE(public.approval_nodes.activated_at, EXCLUDED.activated_at),
      completed_at = EXCLUDED.completed_at,
      result_action = EXCLUDED.result_action,
      comment = EXCLUDED.comment,
      updated_at = now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_project_node_count FROM upserted;

  WITH summary_task AS (
    SELECT wt.*
    FROM public.workflow_tasks wt
    WHERE wt.workflow_key = 'timesheet'
      AND wt.target_type = 'timesheet'
      AND wt.target_id = p_timesheet_id
      AND wt.scope_type = 'department_summary'
    ORDER BY
      CASE WHEN wt.status = 'pending' THEN 0 ELSE 1 END,
      COALESCE(wt.completed_at, wt.created_at) DESC,
      wt.id DESC
    LIMIT 1
  ),
  summary_row AS (
    SELECT
      COALESCE(t.assignee_user_id, reviewer.assignee_user_id) AS assignee_user_id,
      COALESCE(t.assignee_role, reviewer.assignee_role, 'department_head') AS assignee_role,
      t.id AS source_task_id,
      CASE
        WHEN t.status = 'pending' THEN 'pending'
        WHEN t.status = 'completed' AND t.result_action = 'approve' THEN 'approved'
        WHEN t.status = 'completed' AND t.result_action = 'reject' THEN 'needs_revision'
        WHEN t.status = 'completed' AND t.result_action IN ('cancelled', 'superseded') THEN 'cancelled'
        WHEN v_sheet.status = 'approved' THEN 'approved'
        ELSE 'waiting'
      END AS node_status,
      t.created_at AS activated_at,
      t.completed_at,
      t.result_action,
      COALESCE(t.comment, '') AS comment
    FROM public.psa_resolve_timesheet_department_reviewer(p_timesheet_id) reviewer
    LEFT JOIN summary_task t ON true
    WHERE EXISTS (SELECT 1 FROM summary_task)
       OR v_sheet.status IN ('submitted', 'approved')
  ),
  upserted AS (
    INSERT INTO public.approval_nodes (
      round_id, node_key, node_type, scope_type, scope_id, status,
      assignee_user_id, assignee_role, source_task_id, activated_at,
      completed_at, result_action, comment, updated_at
    )
    SELECT
      v_round_id,
      'summary:department',
      'department_summary',
      'timesheet',
      NULL,
      node_status,
      assignee_user_id,
      assignee_role,
      source_task_id,
      COALESCE(activated_at, now()),
      completed_at,
      result_action,
      comment,
      now()
    FROM summary_row
    ON CONFLICT (round_id, node_key)
    DO UPDATE SET
      status = EXCLUDED.status,
      assignee_user_id = EXCLUDED.assignee_user_id,
      assignee_role = EXCLUDED.assignee_role,
      source_task_id = EXCLUDED.source_task_id,
      activated_at = COALESCE(public.approval_nodes.activated_at, EXCLUDED.activated_at),
      completed_at = EXCLUDED.completed_at,
      result_action = EXCLUDED.result_action,
      comment = EXCLUDED.comment,
      updated_at = now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_summary_node_count FROM upserted;

  WITH summary AS (
    SELECT id
    FROM public.approval_nodes
    WHERE approval_nodes.round_id = v_round_id
      AND node_key = 'summary:department'
  ),
  projects AS (
    SELECT id
    FROM public.approval_nodes
    WHERE approval_nodes.round_id = v_round_id
      AND node_type = 'project_review'
  ),
  upserted AS (
    INSERT INTO public.approval_edges (
      round_id, from_node_id, to_node_id, condition_type, condition_expr
    )
    SELECT
      v_round_id,
      projects.id,
      summary.id,
      'all_approved',
      jsonb_build_object('gate', 'department_summary')
    FROM projects
    CROSS JOIN summary
    ON CONFLICT (round_id, from_node_id, to_node_id, condition_type) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_edge_count FROM upserted;

  INSERT INTO public.approval_events (
    instance_id, round_id, actor_id, event_type, comment, payload
  )
  VALUES (
    v_instance_id,
    v_round_id,
    v_actor_id,
    COALESCE(NULLIF(p_event_type, ''), 'sync'),
    COALESCE(p_comment, ''),
    jsonb_build_object(
      'timesheetId', p_timesheet_id,
      'timesheetStatus', v_sheet.status,
      'projectNodeCount', v_project_node_count,
      'summaryNodeCount', v_summary_node_count,
      'edgeCount', v_edge_count
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'instanceId', v_instance_id,
    'roundId', v_round_id,
    'projectNodeCount', v_project_node_count,
    'summaryNodeCount', v_summary_node_count,
    'edgeCount', v_edge_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_sync_timesheet_approval_graph_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_timesheet_id bigint;
  v_event_type text;
  v_comment text;
BEGIN
  IF TG_TABLE_NAME = 'workflow_tasks' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.workflow_key <> 'timesheet' OR OLD.target_type <> 'timesheet' THEN
        RETURN OLD;
      END IF;
      v_timesheet_id := OLD.target_id;
      v_event_type := 'task_deleted';
      v_comment := COALESCE(OLD.comment, '');
    ELSE
      IF NEW.workflow_key <> 'timesheet' OR NEW.target_type <> 'timesheet' THEN
        RETURN NEW;
      END IF;
      v_timesheet_id := NEW.target_id;
      v_event_type := CASE
        WHEN TG_OP = 'INSERT' THEN 'task_created'
        WHEN NEW.status = 'completed' THEN COALESCE(NEW.result_action, 'task_completed')
        ELSE 'task_updated'
      END;
      v_comment := COALESCE(NEW.comment, '');
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    v_timesheet_id := NEW.id;
    IF NEW.status NOT IN ('submitted', 'approved', 'rejected')
       AND NOT EXISTS (
         SELECT 1
         FROM public.workflow_tasks wt
         WHERE wt.workflow_key = 'timesheet'
           AND wt.target_type = 'timesheet'
           AND wt.target_id = NEW.id
       ) THEN
      RETURN NEW;
    END IF;
    v_event_type := CASE
      WHEN TG_OP = 'INSERT' THEN 'timesheet_created'
      WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'timesheet_status_changed'
      ELSE 'timesheet_updated'
    END;
    v_comment := COALESCE(NEW.review_comment, '');
  END IF;

  BEGIN
    PERFORM public.psa_sync_timesheet_approval_graph(v_timesheet_id, v_event_type, v_comment);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'approval graph sync skipped for timesheet %: %', v_timesheet_id, SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_timesheet_graph_from_tasks ON public.workflow_tasks;
CREATE TRIGGER trg_sync_timesheet_graph_from_tasks
AFTER INSERT OR UPDATE OR DELETE ON public.workflow_tasks
FOR EACH ROW
EXECUTE FUNCTION public.psa_sync_timesheet_approval_graph_trigger();

DROP TRIGGER IF EXISTS trg_sync_timesheet_graph_from_timesheets ON public.timesheets;
CREATE TRIGGER trg_sync_timesheet_graph_from_timesheets
AFTER INSERT OR UPDATE OF status, submitted_at, approved_at, review_comment ON public.timesheets
FOR EACH ROW
EXECUTE FUNCTION public.psa_sync_timesheet_approval_graph_trigger();

WITH candidate_timesheets AS (
  SELECT DISTINCT t.id
  FROM public.timesheets t
  WHERE EXISTS (
    SELECT 1
    FROM public.workflow_tasks wt
    WHERE wt.workflow_key = 'timesheet'
      AND wt.target_type = 'timesheet'
      AND wt.target_id = t.id
  )
    OR t.status IN ('submitted', 'approved', 'rejected')
)
SELECT public.psa_sync_timesheet_approval_graph(id, 'backfill', 'V0.12.8 graph backfill')
FROM candidate_timesheets;

ALTER FUNCTION public.psa_approval_instance_status(text) OWNER TO postgres;
ALTER FUNCTION public.psa_ensure_timesheet_approval_round(bigint, bigint, text, text) OWNER TO postgres;
ALTER FUNCTION public.psa_sync_timesheet_approval_graph(bigint, text, text) OWNER TO postgres;
ALTER FUNCTION public.psa_sync_timesheet_approval_graph_trigger() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.psa_approval_instance_status(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_ensure_timesheet_approval_round(bigint, bigint, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_sync_timesheet_approval_graph(bigint, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_approval_instance_status(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_ensure_timesheet_approval_round(bigint, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_sync_timesheet_approval_graph(bigint, text, text) TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.approval_instances TO authenticated;
GRANT SELECT ON public.approval_rounds TO authenticated;
GRANT SELECT ON public.approval_nodes TO authenticated;
GRANT SELECT ON public.approval_edges TO authenticated;
GRANT SELECT ON public.approval_events TO authenticated;

COMMIT;
