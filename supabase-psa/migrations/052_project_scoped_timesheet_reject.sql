-- V0.15: keep timesheet project rejection scoped to the rejected project block.

BEGIN;

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
  v_is_timesheet_project boolean := false;
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

  SELECT EXISTS (
    SELECT 1
    FROM public.approval_instances i
    LEFT JOIN public.business_documents d ON d.id = i.document_id
    WHERE i.id = v_node.instance_id
      AND COALESCE(i.target_type, d.document_type) = 'timesheet'
      AND v_node.scope_type = 'project'
      AND v_node.scope_id IS NOT NULL
  ) INTO v_is_timesheet_project;

  UPDATE public.approval_node_assignees
  SET status = 'rejected',
      action = 'reject',
      comment = COALESCE(p_comment, ''),
      acted_at = now()
  WHERE id = v_assignee.id
    AND status = 'pending';

  UPDATE public.approval_node_assignees
  SET status = 'cancelled',
      action = 'cancelled',
      acted_at = now()
  WHERE node_id = p_node_id
    AND id <> v_assignee.id
    AND status = 'pending';

  UPDATE public.approval_nodes
  SET status = 'rejected',
      result_action = 'reject',
      comment = COALESCE(p_comment, ''),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_node_id
    AND status = 'active';

  IF v_is_timesheet_project THEN
    UPDATE public.approval_node_assignees a
    SET status = 'pending',
        action = NULL,
        comment = NULL,
        acted_at = NULL
    FROM public.approval_nodes n
    WHERE a.node_id = n.id
      AND n.round_id = v_node.round_id
      AND n.scope_type = v_node.scope_type
      AND n.scope_id = v_node.scope_id
      AND n.id <> p_node_id
      AND n.status IN ('approved', 'skipped')
      AND a.status IN ('approved', 'skipped');

    UPDATE public.approval_nodes
    SET status = 'needs_reapproval',
        result_action = NULL,
        completed_at = NULL,
        comment = COALESCE(NULLIF(comment, ''), 'Rolled back after project rejection'),
        updated_at = now()
    WHERE round_id = v_node.round_id
      AND scope_type = v_node.scope_type
      AND scope_id = v_node.scope_id
      AND id <> p_node_id
      AND status IN ('approved', 'skipped');

    UPDATE public.approval_node_assignees a
    SET status = 'cancelled',
        action = 'cancelled',
        acted_at = now()
    FROM public.approval_nodes n
    WHERE a.node_id = n.id
      AND n.round_id = v_node.round_id
      AND n.scope_type = v_node.scope_type
      AND n.scope_id = v_node.scope_id
      AND n.id <> p_node_id
      AND n.status IN ('waiting', 'active', 'pending')
      AND a.status = 'pending';

    UPDATE public.approval_nodes
    SET status = 'cancelled',
        result_action = 'cancelled',
        updated_at = now()
    WHERE round_id = v_node.round_id
      AND scope_type = v_node.scope_type
      AND scope_id = v_node.scope_id
      AND id <> p_node_id
      AND status IN ('waiting', 'active', 'pending');

    UPDATE public.timesheets t
    SET status = 'submitted',
        review_comment = COALESCE(p_comment, ''),
        approved_by = NULL,
        approved_at = NULL,
        updated_at = now()
    FROM public.approval_instances i
    WHERE i.id = v_node.instance_id
      AND i.target_type = 'timesheet'
      AND t.id = i.target_id;
  ELSE
    UPDATE public.approval_node_assignees a
    SET status = 'pending',
        action = NULL,
        comment = NULL,
        acted_at = NULL
    FROM public.approval_nodes n
    WHERE a.node_id = n.id
      AND n.round_id = v_node.round_id
      AND n.id <> p_node_id
      AND n.status IN ('approved', 'skipped')
      AND a.status IN ('approved', 'skipped');

    UPDATE public.approval_nodes
    SET status = 'needs_reapproval',
        result_action = NULL,
        completed_at = NULL,
        comment = COALESCE(NULLIF(comment, ''), 'Rolled back after downstream rejection'),
        updated_at = now()
    WHERE round_id = v_node.round_id
      AND id <> p_node_id
      AND status IN ('approved', 'skipped');

    UPDATE public.approval_node_assignees a
    SET status = 'cancelled',
        action = 'cancelled',
        acted_at = now()
    FROM public.approval_nodes n
    WHERE a.node_id = n.id
      AND n.round_id = v_node.round_id
      AND n.id <> p_node_id
      AND n.status IN ('waiting', 'active', 'pending')
      AND a.status = 'pending';

    UPDATE public.approval_nodes
    SET status = 'cancelled',
        result_action = 'cancelled',
        updated_at = now()
    WHERE round_id = v_node.round_id
      AND id <> p_node_id
      AND status IN ('waiting', 'active', 'pending');

    UPDATE public.approval_rounds
    SET status = 'revision_required',
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE id = v_node.round_id;

    UPDATE public.approval_instances
    SET status = 'revision_required',
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE id = v_node.instance_id;

    UPDATE public.business_documents d
    SET lifecycle_status = 'revision_required',
        approved_at = NULL,
        cancelled_at = NULL,
        updated_at = now()
    FROM public.approval_instances i
    WHERE i.id = v_node.instance_id
      AND d.id = i.document_id;

    UPDATE public.timesheets t
    SET status = 'rejected',
        review_comment = COALESCE(p_comment, ''),
        approved_by = NULL,
        approved_at = NULL,
        updated_at = now()
    FROM public.approval_instances i
    WHERE i.id = v_node.instance_id
      AND i.target_type = 'timesheet'
      AND t.id = i.target_id;
  END IF;

  PERFORM public.psa_write_approval_event(
    v_node.instance_id, v_node.round_id, v_node.id, v_assignee.id, v_actor,
    'assignee_rejected', 'pending', 'rejected', p_request_id, p_comment,
    jsonb_build_object('reject_policy', p_reject_policy, 'target_node_key', p_target_node_key, 'project_scoped', v_is_timesheet_project)
  );

  RETURN jsonb_build_object('ok', true, 'node_id', p_node_id, 'rolled_back', true, 'project_scoped', v_is_timesheet_project);
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

GRANT EXECUTE ON FUNCTION public.reject_node(bigint, bigint, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
