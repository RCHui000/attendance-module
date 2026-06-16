-- V0.16 hotfix: admin review queue shows all pending timesheet nodes, so
-- explicit task actions from admin must be executable even when admin is not
-- the original pending assignee. Keep normal users constrained to their own
-- pending assignments.

BEGIN;

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

  IF v_assignee.id IS NULL AND public.current_user_has_role('admin') THEN
    INSERT INTO public.approval_node_assignees(node_id, assignee_user_id, assignee_employee_id, status)
    VALUES (p_node_id, v_actor, v_actor, 'pending')
    ON CONFLICT (node_id, assignee_user_id)
    DO UPDATE SET status = 'pending', action = NULL, comment = NULL, acted_at = NULL
    RETURNING * INTO v_assignee;
  END IF;

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
  v_round_id bigint;
  v_has_project_revision boolean := false;
BEGIN
  SELECT * INTO v_sheet FROM public.timesheets WHERE id = p_timesheet_id FOR UPDATE;
  IF v_sheet.id IS NULL THEN
    RAISE EXCEPTION 'Timesheet not found';
  END IF;

  v_request_id := 'timesheet:' || p_timesheet_id || ':' || p_action || ':' || COALESCE(p_task_id::text, 'submit') || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::text;

  IF p_action = 'submit' THEN
    SELECT i.current_round_id INTO v_round_id
    FROM public.approval_instances i
    WHERE i.target_type = 'timesheet'
      AND i.target_id = p_timesheet_id
      AND i.status = 'running'
    LIMIT 1;

    IF v_round_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.approval_nodes n
        WHERE n.round_id = v_round_id
          AND n.scope_type = 'project'
          AND n.status IN ('rejected', 'needs_reapproval', 'cancelled')
          AND EXISTS (
            SELECT 1
            FROM public.approval_nodes rejected
            WHERE rejected.round_id = v_round_id
              AND rejected.scope_type = 'project'
              AND rejected.scope_id = n.scope_id
              AND rejected.status = 'rejected'
          )
      ) INTO v_has_project_revision;

      IF v_has_project_revision THEN
        WITH rejected_projects AS (
          SELECT DISTINCT scope_id
          FROM public.approval_nodes
          WHERE round_id = v_round_id
            AND scope_type = 'project'
            AND status = 'rejected'
        )
        DELETE FROM public.approval_node_assignees a
        USING public.approval_nodes n, rejected_projects rp
        WHERE a.node_id = n.id
          AND n.round_id = v_round_id
          AND n.scope_type = 'project'
          AND n.scope_id = rp.scope_id;

        WITH rejected_projects AS (
          SELECT DISTINCT scope_id
          FROM public.approval_nodes
          WHERE round_id = v_round_id
            AND scope_type = 'project'
            AND status = 'rejected'
        )
        UPDATE public.approval_nodes n
        SET status = 'waiting',
            result_action = NULL,
            completed_at = NULL,
            activated_at = NULL,
            comment = '',
            updated_at = now()
        FROM rejected_projects rp
        WHERE n.round_id = v_round_id
          AND n.scope_type = 'project'
          AND n.scope_id = rp.scope_id;

        UPDATE public.timesheets
        SET status = 'submitted',
            submitted_at = COALESCE(submitted_at, now()),
            updated_at = now()
        WHERE id = p_timesheet_id;

        PERFORM public.psa_activate_ready_nodes(v_round_id);
        RETURN jsonb_build_object('ok', true, 'action', p_action, 'storage', 'approval_graph', 'resubmitted_project_blocks', true);
      END IF;
    END IF;

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
      AND n.status = 'active'
      AND (
        public.current_user_has_role('admin')
        OR EXISTS (
          SELECT 1
          FROM public.approval_node_assignees a
          WHERE a.node_id = n.id
            AND a.status = 'pending'
            AND a.assignee_user_id = v_actor
        )
      )
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

ALTER FUNCTION public.approve_node(bigint, bigint, text, text) OWNER TO postgres;
ALTER FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_node(bigint, bigint, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_node(bigint, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
