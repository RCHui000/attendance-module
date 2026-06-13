-- V0.15: migrate legacy workflow_tasks into Approval Graph and remove the legacy task table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.approval_graph_cutover_audit (
  id BIGSERIAL PRIMARY KEY,
  release_version TEXT NOT NULL,
  old_pending_tasks INT NOT NULL DEFAULT 0,
  migrated_pending_tasks INT NOT NULL DEFAULT 0,
  old_reviewed_tasks INT NOT NULL DEFAULT 0,
  migrated_reviewed_tasks INT NOT NULL DEFAULT 0,
  old_project_blocks INT NOT NULL DEFAULT 0,
  migrated_project_blocks INT NOT NULL DEFAULT 0,
  old_department_summaries INT NOT NULL DEFAULT 0,
  migrated_department_summaries INT NOT NULL DEFAULT 0,
  graph_pending_total INT NOT NULL DEFAULT 0,
  graph_reviewed_total INT NOT NULL DEFAULT 0,
  graph_project_block_total INT NOT NULL DEFAULT 0,
  graph_department_summary_total INT NOT NULL DEFAULT 0,
  workflow_tasks_dropped BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.psa_v015_migrate_workflow_tasks_to_graph()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sheet RECORD;
  v_task RECORD;
  v_template_id BIGINT;
  v_template_version INT;
  v_doc_id BIGINT;
  v_instance_id BIGINT;
  v_round_id BIGINT;
  v_node_id BIGINT;
  v_assignee_user_id BIGINT;
  v_creator_org_id BIGINT;
  v_project_id BIGINT;
  v_node_status TEXT;
  v_assignee_status TEXT;
  v_result_action TEXT;
  v_node_key TEXT;
BEGIN
  IF to_regclass('public.workflow_tasks') IS NULL THEN
    RETURN;
  END IF;

  SELECT id, version
    INTO v_template_id, v_template_version
  FROM public.approval_templates
  WHERE template_key = 'timesheet_parallel_v1'
  ORDER BY version DESC, id DESC
  LIMIT 1;

  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'timesheet_parallel_v1 approval template is required before V0.15 cutover';
  END IF;

  FOR v_sheet IN
    SELECT DISTINCT t.*
    FROM public.timesheets t
    JOIN public.workflow_tasks wt
      ON wt.target_type = 'timesheet'
     AND wt.target_id = t.id
    WHERE wt.workflow_key = 'timesheet'
  LOOP
    SELECT ep.org_id
      INTO v_creator_org_id
    FROM public.employee_profiles ep
    WHERE ep.employee_id = v_sheet.user_id
    ORDER BY ep.created_at ASC NULLS LAST
    LIMIT 1;

    SELECT te.project_id
      INTO v_project_id
    FROM public.timesheet_entries te
    WHERE te.timesheet_id = v_sheet.id
      AND te.project_id IS NOT NULL
    ORDER BY te.project_id
    LIMIT 1;

    INSERT INTO public.business_documents (
      document_type, business_id, business_version, creator_user_id, creator_employee_id,
      creator_org_id, project_id, business_type, lifecycle_status, submitted_at,
      approved_at, cancelled_at, updated_at
    )
    VALUES (
      'timesheet',
      v_sheet.id,
      1,
      v_sheet.user_id,
      v_sheet.user_id,
      v_creator_org_id,
      v_project_id,
      'timesheet',
      CASE
        WHEN v_sheet.status = 'approved' THEN 'approved'
        WHEN v_sheet.status IN ('rejected', 'revision_required') THEN 'revision_required'
        WHEN v_sheet.status = 'submitted' THEN 'in_approval'
        ELSE 'draft'
      END,
      v_sheet.submitted_at,
      CASE WHEN v_sheet.status = 'approved' THEN v_sheet.updated_at ELSE NULL END,
      NULL,
      now()
    )
    ON CONFLICT (document_type, business_id, business_version) DO UPDATE
    SET creator_user_id = EXCLUDED.creator_user_id,
        creator_employee_id = EXCLUDED.creator_employee_id,
        creator_org_id = EXCLUDED.creator_org_id,
        project_id = COALESCE(EXCLUDED.project_id, public.business_documents.project_id),
        lifecycle_status = EXCLUDED.lifecycle_status,
        submitted_at = COALESCE(public.business_documents.submitted_at, EXCLUDED.submitted_at),
        approved_at = COALESCE(public.business_documents.approved_at, EXCLUDED.approved_at),
        updated_at = now()
    RETURNING id INTO v_doc_id;

    INSERT INTO public.approval_instances (
      approval_key, target_type, target_id, status, created_by, document_id,
      template_id, template_version, template_snapshot, current_round, updated_at
    )
    VALUES (
      'timesheet',
      'timesheet',
      v_sheet.id,
      CASE
        WHEN v_sheet.status = 'approved' THEN 'approved'
        WHEN v_sheet.status IN ('rejected', 'revision_required') THEN 'revision_required'
        ELSE 'running'
      END,
      v_sheet.user_id,
      v_doc_id,
      v_template_id,
      v_template_version,
      public.psa_template_snapshot(v_template_id),
      1,
      now()
    )
    ON CONFLICT (target_type, target_id) DO UPDATE
    SET approval_key = 'timesheet',
        document_id = COALESCE(public.approval_instances.document_id, EXCLUDED.document_id),
        template_id = COALESCE(public.approval_instances.template_id, EXCLUDED.template_id),
        template_version = EXCLUDED.template_version,
        template_snapshot = CASE
          WHEN public.approval_instances.template_snapshot = '{}'::jsonb THEN EXCLUDED.template_snapshot
          ELSE public.approval_instances.template_snapshot
        END,
        status = EXCLUDED.status,
        updated_at = now()
    RETURNING id INTO v_instance_id;

    INSERT INTO public.approval_rounds (
      instance_id, round_no, round_type, status, started_by, created_by, reason, updated_at
    )
    VALUES (
      v_instance_id,
      1,
      'backfill',
      CASE
        WHEN v_sheet.status = 'approved' THEN 'approved'
        WHEN v_sheet.status IN ('rejected', 'revision_required') THEN 'revision_required'
        ELSE 'running'
      END,
      v_sheet.user_id,
      v_sheet.user_id,
      'V0.15 workflow_tasks migration',
      now()
    )
    ON CONFLICT (instance_id, round_no) DO UPDATE
    SET status = EXCLUDED.status,
        reason = COALESCE(public.approval_rounds.reason, EXCLUDED.reason),
        updated_at = now()
    RETURNING id INTO v_round_id;

    UPDATE public.approval_instances
    SET current_round_id = v_round_id,
        current_round = 1,
        updated_at = now()
    WHERE id = v_instance_id;

    FOR v_task IN
      SELECT wt.*
      FROM public.workflow_tasks wt
      WHERE wt.workflow_key = 'timesheet'
        AND wt.target_type = 'timesheet'
        AND wt.target_id = v_sheet.id
      ORDER BY wt.created_at NULLS LAST, wt.id
    LOOP
      v_assignee_user_id := COALESCE(v_task.assignee_user_id, v_task.completed_by, v_task.created_by);
      v_result_action := CASE
        WHEN v_task.result_action IN ('approve', 'reject') THEN v_task.result_action
        WHEN v_task.status = 'completed' THEN 'approve'
        ELSE v_task.result_action
      END;
      v_node_status := CASE
        WHEN v_task.status = 'pending' THEN 'active'
        WHEN v_task.status = 'completed' AND v_result_action = 'reject' THEN 'rejected'
        WHEN v_task.status = 'completed' THEN 'approved'
        WHEN v_task.status = 'cancelled' THEN 'cancelled'
        ELSE 'skipped'
      END;
      v_assignee_status := CASE
        WHEN v_task.status = 'pending' THEN 'pending'
        WHEN v_task.status = 'completed' AND v_result_action = 'reject' THEN 'rejected'
        WHEN v_task.status = 'completed' THEN 'approved'
        WHEN v_task.status = 'cancelled' THEN 'cancelled'
        ELSE 'skipped'
      END;
      v_node_key := 'workflow_task_' || v_task.id::text;
      v_node_id := NULL;

      SELECT n.id
        INTO v_node_id
      FROM public.approval_nodes n
      WHERE n.source_task_id = v_task.id
      ORDER BY n.id DESC
      LIMIT 1;

      IF v_node_id IS NULL AND v_assignee_user_id IS NOT NULL THEN
        SELECT n.id
          INTO v_node_id
        FROM public.approval_nodes n
        JOIN public.approval_node_assignees a ON a.node_id = n.id
        WHERE n.round_id = v_round_id
          AND n.source_task_id IS NULL
          AND n.scope_type = COALESCE(v_task.scope_type, 'timesheet')
          AND n.scope_id IS NOT DISTINCT FROM v_task.scope_id
          AND a.assignee_user_id = v_assignee_user_id
        ORDER BY n.id DESC
        LIMIT 1;
      END IF;

      IF v_node_id IS NULL THEN
        INSERT INTO public.approval_nodes (
          round_id, instance_id, node_key, template_node_key, node_name, node_type,
          scope_type, scope_id, status, assignee_user_id, assignee_role,
          resolver_type, resolver_role, approval_policy, reject_policy,
          source_task_id, activated_at, completed_at, result_action, comment,
          metadata, snapshot, updated_at
        )
        VALUES (
          v_round_id,
          v_instance_id,
          v_node_key,
          CASE
            WHEN COALESCE(v_task.scope_type, 'timesheet') = 'project' THEN 'project_review'
            WHEN COALESCE(v_task.scope_type, 'timesheet') = 'department_summary' THEN 'department_summary'
            ELSE 'timesheet_review'
          END,
          CASE
            WHEN COALESCE(v_task.scope_type, 'timesheet') = 'project' THEN 'Project Review'
            WHEN COALESCE(v_task.scope_type, 'timesheet') = 'department_summary' THEN 'Department Summary Review'
            ELSE 'Timesheet Review'
          END,
          'approval',
          COALESCE(v_task.scope_type, 'timesheet'),
          v_task.scope_id,
          v_node_status,
          v_assignee_user_id,
          v_task.assignee_role,
          CASE WHEN COALESCE(v_task.scope_type, 'timesheet') = 'department_summary' THEN 'org_manager' ELSE 'project_role' END,
          v_task.assignee_role,
          'single',
          'back_to_creator',
          v_task.id,
          COALESCE(v_task.created_at, now()),
          v_task.completed_at,
          v_result_action,
          COALESCE(v_task.comment, ''),
          jsonb_build_object('migrated_from', 'workflow_tasks', 'workflow_task_id', v_task.id),
          jsonb_build_object('migrated_from', 'workflow_tasks', 'workflow_task_id', v_task.id, 'route_source', v_task.route_source),
          now()
        )
        RETURNING id INTO v_node_id;
      ELSE
        UPDATE public.approval_nodes
        SET node_key = COALESCE(public.approval_nodes.node_key, v_node_key),
            template_node_key = CASE
              WHEN COALESCE(v_task.scope_type, 'timesheet') = 'project' THEN 'project_review'
              WHEN COALESCE(v_task.scope_type, 'timesheet') = 'department_summary' THEN 'department_summary'
              ELSE COALESCE(public.approval_nodes.template_node_key, 'timesheet_review')
            END,
            node_name = CASE
              WHEN COALESCE(v_task.scope_type, 'timesheet') = 'project' THEN 'Project Review'
              WHEN COALESCE(v_task.scope_type, 'timesheet') = 'department_summary' THEN 'Department Summary Review'
              ELSE COALESCE(public.approval_nodes.node_name, 'Timesheet Review')
            END,
            node_type = 'approval',
            scope_type = COALESCE(v_task.scope_type, 'timesheet'),
            scope_id = v_task.scope_id,
            status = v_node_status,
            assignee_user_id = v_assignee_user_id,
            assignee_role = v_task.assignee_role,
            resolver_role = v_task.assignee_role,
            source_task_id = v_task.id,
            activated_at = COALESCE(public.approval_nodes.activated_at, v_task.created_at, now()),
            completed_at = v_task.completed_at,
            result_action = v_result_action,
            comment = COALESCE(v_task.comment, ''),
            metadata = COALESCE(public.approval_nodes.metadata, '{}'::jsonb)
              || jsonb_build_object('migrated_from', 'workflow_tasks', 'workflow_task_id', v_task.id),
            snapshot = COALESCE(public.approval_nodes.snapshot, '{}'::jsonb)
              || jsonb_build_object('migrated_from', 'workflow_tasks', 'workflow_task_id', v_task.id, 'route_source', v_task.route_source),
            updated_at = now()
        WHERE id = v_node_id;
      END IF;

      IF v_assignee_user_id IS NOT NULL THEN
        INSERT INTO public.approval_node_assignees (
          node_id, assignee_user_id, assignee_employee_id, status, action,
          comment, acted_at
        )
        VALUES (
          v_node_id,
          v_assignee_user_id,
          v_assignee_user_id,
          v_assignee_status,
          v_result_action,
          COALESCE(v_task.comment, ''),
          v_task.completed_at
        )
        ON CONFLICT (node_id, assignee_user_id) DO UPDATE
        SET status = EXCLUDED.status,
            action = EXCLUDED.action,
            comment = EXCLUDED.comment,
            acted_at = EXCLUDED.acted_at;
      END IF;

      INSERT INTO public.approval_events (
        instance_id, round_id, node_id, actor_id, actor_user_id, actor_employee_id,
        event_type, comment, payload, created_at
      )
      VALUES (
        v_instance_id,
        v_round_id,
        v_node_id,
        COALESCE(v_task.completed_by, v_task.created_by, v_assignee_user_id),
        COALESCE(v_task.completed_by, v_task.created_by, v_assignee_user_id),
        COALESCE(v_task.completed_by, v_task.created_by, v_assignee_user_id),
        CASE
          WHEN v_task.status = 'pending' THEN 'workflow_task_migrated_pending'
          WHEN v_result_action = 'reject' THEN 'workflow_task_migrated_rejected'
          ELSE 'workflow_task_migrated_approved'
        END,
        COALESCE(v_task.comment, ''),
        jsonb_build_object('workflow_task_id', v_task.id, 'release', 'V0.15'),
        COALESCE(v_task.completed_at, v_task.created_at, now())
      );
    END LOOP;

    INSERT INTO public.approval_edges (
      round_id, instance_id, from_node_id, to_node_id, condition_type,
      condition_expr, edge_type, condition_result
    )
    SELECT DISTINCT
      v_round_id,
      v_instance_id,
      project_node.id,
      summary_node.id,
      'all_approved',
      '{}'::jsonb,
      'normal',
      true
    FROM public.approval_nodes project_node
    JOIN public.approval_nodes summary_node
      ON summary_node.round_id = v_round_id
     AND summary_node.scope_type = 'department_summary'
    WHERE project_node.round_id = v_round_id
      AND project_node.scope_type = 'project'
      AND project_node.id <> summary_node.id
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

SELECT public.psa_v015_migrate_workflow_tasks_to_graph();

DROP VIEW IF EXISTS public.approval_project_review_records_view;
DROP VIEW IF EXISTS public.approval_reviewed_timesheets_view;
DROP VIEW IF EXISTS public.approval_pending_tasks_view;

CREATE VIEW public.approval_pending_tasks_view AS
SELECT
  n.id,
  n.id AS task_id,
  COALESCE(i.target_type, d.document_type) AS target_type,
  COALESCE(i.target_id, d.business_id) AS target_id,
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
LEFT JOIN public.business_documents d ON d.id = i.document_id
JOIN public.approval_node_assignees a ON a.node_id = n.id
WHERE COALESCE(i.target_type, d.document_type) = 'timesheet'
  AND n.status = 'active'
  AND a.status = 'pending';

CREATE VIEW public.approval_reviewed_timesheets_view AS
SELECT
  n.id,
  n.id AS task_id,
  COALESCE(i.target_type, d.document_type) AS target_type,
  COALESCE(i.target_id, d.business_id) AS target_id,
  COALESCE(i.target_id, d.business_id) AS timesheet_id,
  n.scope_type,
  n.scope_id,
  n.assignee_role,
  a.assignee_user_id,
  CASE
    WHEN a.action IN ('approve', 'reject') THEN a.action
    WHEN a.status = 'approved' THEN 'approve'
    WHEN a.status = 'rejected' THEN 'reject'
    ELSE a.action
  END AS result_action,
  a.comment,
  a.acted_at AS completed_at
FROM public.approval_node_assignees a
JOIN public.approval_nodes n ON n.id = a.node_id
JOIN public.approval_instances i ON i.id = n.instance_id
LEFT JOIN public.business_documents d ON d.id = i.document_id
WHERE COALESCE(i.target_type, d.document_type) = 'timesheet'
  AND a.status IN ('approved', 'rejected', 'delegated', 'skipped');

CREATE VIEW public.approval_project_review_records_view AS
SELECT
  COALESCE(i.target_id, d.business_id) AS timesheet_id,
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
LEFT JOIN public.business_documents d ON d.id = i.document_id
WHERE COALESCE(i.target_type, d.document_type) = 'timesheet'
  AND n.scope_type = 'project'
  AND n.scope_id IS NOT NULL;

GRANT SELECT ON public.approval_pending_tasks_view TO authenticated;
GRANT SELECT ON public.approval_reviewed_timesheets_view TO authenticated;
GRANT SELECT ON public.approval_project_review_records_view TO authenticated;
GRANT SELECT ON public.approval_graph_cutover_audit TO authenticated;

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
    DELETE FROM public.approval_instances
    WHERE target_type = 'timesheet'
      AND target_id = p_timesheet_id
      AND status <> 'running';

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
      jsonb_build_object('source', 'psa_timesheet_action', 'storage', 'approval_graph'),
      v_request_id
    );

    RETURN jsonb_build_object('ok', true, 'action', p_action, 'storage', 'approval_graph');
  END IF;

  IF p_action = 'reopen' THEN
    UPDATE public.approval_node_assignees a
    SET status = 'cancelled'
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    WHERE a.node_id = n.id
      AND i.target_type = 'timesheet'
      AND i.target_id = p_timesheet_id
      AND a.status = 'pending';

    UPDATE public.approval_nodes n
    SET status = 'cancelled',
        updated_at = now()
    FROM public.approval_instances i
    WHERE i.id = n.instance_id
      AND i.target_type = 'timesheet'
      AND i.target_id = p_timesheet_id
      AND n.status IN ('waiting', 'pending', 'active');

    UPDATE public.approval_instances
    SET status = 'cancelled',
        completed_at = now(),
        updated_at = now()
    WHERE target_type = 'timesheet'
      AND target_id = p_timesheet_id;

    UPDATE public.business_documents
    SET lifecycle_status = 'cancelled',
        cancelled_at = now(),
        updated_at = now()
    WHERE document_type = 'timesheet'
      AND business_id = p_timesheet_id
      AND business_version = 1;

    UPDATE public.timesheets
    SET status = 'draft',
        review_comment = COALESCE(NULLIF(p_comment, ''), review_comment),
        updated_at = now()
    WHERE id = p_timesheet_id;

    RETURN jsonb_build_object('ok', true, 'action', p_action, 'storage', 'approval_graph');
  END IF;

  IF p_task_id IS NOT NULL THEN
    SELECT n.id INTO v_node_id
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    WHERE n.id = p_task_id
      AND i.target_type = 'timesheet'
      AND i.target_id = p_timesheet_id
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

  RETURN v_result || jsonb_build_object('storage', 'approval_graph');
END;
$$;

ALTER FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.psa_refresh_pending_project_review_routes(
  p_project_id bigint,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN jsonb_build_object(
    'ok', true,
    'storage', 'approval_graph',
    'project_id', p_project_id,
    'reason', p_reason,
    'message', 'workflow_tasks was dropped in V0.15; existing graph nodes keep their submitted routing snapshot'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_refresh_timesheet_routes(
  p_timesheet_id bigint,
  p_project_id bigint DEFAULT NULL,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN jsonb_build_object(
    'ok', true,
    'storage', 'approval_graph',
    'timesheet_id', p_timesheet_id,
    'project_id', p_project_id,
    'reason', p_reason,
    'message', 'workflow_tasks was dropped in V0.15; submitted graph routes are immutable snapshots'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.psa_refresh_project_timesheet_routes(
  p_project_id bigint,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN public.psa_refresh_pending_project_review_routes(p_project_id, p_reason);
END;
$$;

ALTER FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) OWNER TO postgres;
ALTER FUNCTION public.psa_refresh_timesheet_routes(bigint, bigint, text) OWNER TO postgres;
ALTER FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_refresh_timesheet_routes(bigint, bigint, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_refresh_pending_project_review_routes(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_refresh_timesheet_routes(bigint, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_refresh_project_timesheet_routes(bigint, text) TO authenticated;

DO $$
DECLARE
  v_old_pending INT := 0;
  v_new_pending INT := 0;
  v_old_reviewed INT := 0;
  v_new_reviewed INT := 0;
  v_old_project INT := 0;
  v_new_project INT := 0;
  v_old_summary INT := 0;
  v_new_summary INT := 0;
  v_graph_pending INT := 0;
  v_graph_reviewed INT := 0;
  v_graph_project INT := 0;
  v_graph_summary INT := 0;
BEGIN
  IF to_regclass('public.workflow_tasks') IS NOT NULL THEN
    SELECT count(*) INTO v_old_pending
    FROM public.workflow_tasks
    WHERE workflow_key = 'timesheet'
      AND target_type = 'timesheet'
      AND status = 'pending';

    SELECT count(*) INTO v_old_reviewed
    FROM public.workflow_tasks
    WHERE workflow_key = 'timesheet'
      AND target_type = 'timesheet'
      AND status = 'completed'
      AND result_action IN ('approve', 'reject');

    SELECT count(*) INTO v_old_project
    FROM public.workflow_tasks
    WHERE workflow_key = 'timesheet'
      AND target_type = 'timesheet'
      AND scope_type = 'project';

    SELECT count(*) INTO v_old_summary
    FROM public.workflow_tasks
    WHERE workflow_key = 'timesheet'
      AND target_type = 'timesheet'
      AND scope_type = 'department_summary';

    SELECT count(DISTINCT n.source_task_id) INTO v_new_pending
    FROM public.approval_nodes n
    JOIN public.approval_node_assignees a ON a.node_id = n.id
    JOIN public.workflow_tasks wt ON wt.id = n.source_task_id
    WHERE wt.workflow_key = 'timesheet'
      AND wt.target_type = 'timesheet'
      AND wt.status = 'pending'
      AND n.status = 'active'
      AND a.status = 'pending';

    SELECT count(DISTINCT n.source_task_id) INTO v_new_reviewed
    FROM public.approval_nodes n
    JOIN public.approval_node_assignees a ON a.node_id = n.id
    JOIN public.workflow_tasks wt ON wt.id = n.source_task_id
    WHERE wt.workflow_key = 'timesheet'
      AND wt.target_type = 'timesheet'
      AND wt.status = 'completed'
      AND wt.result_action IN ('approve', 'reject')
      AND a.status IN ('approved', 'rejected');

    SELECT count(DISTINCT n.source_task_id) INTO v_new_project
    FROM public.approval_nodes n
    JOIN public.workflow_tasks wt ON wt.id = n.source_task_id
    WHERE wt.workflow_key = 'timesheet'
      AND wt.target_type = 'timesheet'
      AND wt.scope_type = 'project'
      AND n.scope_type = 'project';

    SELECT count(DISTINCT n.source_task_id) INTO v_new_summary
    FROM public.approval_nodes n
    JOIN public.workflow_tasks wt ON wt.id = n.source_task_id
    WHERE wt.workflow_key = 'timesheet'
      AND wt.target_type = 'timesheet'
      AND wt.scope_type = 'department_summary'
      AND n.scope_type = 'department_summary';

    IF v_old_pending <> v_new_pending
       OR v_old_reviewed <> v_new_reviewed
       OR v_old_project <> v_new_project
       OR v_old_summary <> v_new_summary THEN
      RAISE EXCEPTION
        'V0.15 Approval Graph cutover mismatch: pending %/%, reviewed %/%, project %/%, department_summary %/%',
        v_old_pending, v_new_pending,
        v_old_reviewed, v_new_reviewed,
        v_old_project, v_new_project,
        v_old_summary, v_new_summary;
    END IF;
  END IF;

  SELECT count(*) INTO v_graph_pending FROM public.approval_pending_tasks_view WHERE target_type = 'timesheet';
  SELECT count(*) INTO v_graph_reviewed FROM public.approval_reviewed_timesheets_view WHERE target_type = 'timesheet';
  SELECT count(*) INTO v_graph_project
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  WHERE i.target_type = 'timesheet'
    AND n.scope_type = 'project';
  SELECT count(*) INTO v_graph_summary
  FROM public.approval_nodes n
  JOIN public.approval_instances i ON i.id = n.instance_id
  WHERE i.target_type = 'timesheet'
    AND n.scope_type = 'department_summary';

  INSERT INTO public.approval_graph_cutover_audit (
    release_version,
    old_pending_tasks,
    migrated_pending_tasks,
    old_reviewed_tasks,
    migrated_reviewed_tasks,
    old_project_blocks,
    migrated_project_blocks,
    old_department_summaries,
    migrated_department_summaries,
    graph_pending_total,
    graph_reviewed_total,
    graph_project_block_total,
    graph_department_summary_total
  )
  VALUES (
    'V0.15',
    v_old_pending,
    v_new_pending,
    v_old_reviewed,
    v_new_reviewed,
    v_old_project,
    v_new_project,
    v_old_summary,
    v_new_summary,
    v_graph_pending,
    v_graph_reviewed,
    v_graph_project,
    v_graph_summary
  );
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_timesheet_graph_from_timesheets ON public.timesheets;
DROP TRIGGER IF EXISTS trg_sync_timesheet_graph_from_tasks ON public.workflow_tasks;
DROP TRIGGER IF EXISTS trg_sync_project_reviews_from_tasks ON public.workflow_tasks;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.workflow_tasks;
  EXCEPTION
    WHEN undefined_object THEN NULL;
    WHEN undefined_table THEN NULL;
    WHEN invalid_parameter_value THEN NULL;
  END;
END;
$$;

DROP TABLE IF EXISTS public.workflow_tasks CASCADE;

DROP FUNCTION IF EXISTS public.psa_sync_timesheet_approval_graph(bigint, text, text);
DROP FUNCTION IF EXISTS public.psa_sync_timesheet_approval_graph_trigger();
DROP FUNCTION IF EXISTS public.psa_sync_timesheet_project_review_from_task(bigint);
DROP FUNCTION IF EXISTS public.psa_sync_timesheet_project_reviews_trigger();
DROP FUNCTION IF EXISTS public.psa_project_review_status_from_task(text, text, text);

UPDATE public.approval_graph_cutover_audit
SET workflow_tasks_dropped = (to_regclass('public.workflow_tasks') IS NULL)
WHERE id = (SELECT max(id) FROM public.approval_graph_cutover_audit);

DROP FUNCTION IF EXISTS public.psa_v015_migrate_workflow_tasks_to_graph();

NOTIFY pgrst, 'reload schema';

COMMIT;
