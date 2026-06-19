-- Allow submitters to withdraw a submitted weekly timesheet before it is fully approved.
-- Withdrawing cancels the running Approval Graph, including project-block tasks that
-- were already distributed to approvers, and returns the sheet to draft editing.

BEGIN;

CREATE OR REPLACE VIEW public.approval_project_review_records_view AS
SELECT
  COALESCE(i.target_id, d.business_id) AS timesheet_id,
  n.scope_id AS project_id,
  CASE
    WHEN n.status = 'approved' THEN 'project_approved'
    WHEN n.status = 'rejected' THEN 'needs_revision'
    WHEN n.status = 'cancelled' THEN 'cancelled'
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
  AND i.status <> 'cancelled'
  AND n.scope_type = 'project'
  AND n.scope_id IS NOT NULL;

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

  IF p_action = 'withdraw' THEN
    IF v_sheet.status <> 'submitted' THEN
      RAISE EXCEPTION 'Only submitted timesheets can be withdrawn';
    END IF;
    IF v_sheet.user_id <> v_actor AND NOT public.current_user_has_role('admin') THEN
      RAISE EXCEPTION 'Only the submitter can withdraw this timesheet';
    END IF;

    UPDATE public.approval_node_assignees a
    SET status = 'cancelled',
        action = COALESCE(action, p_action),
        comment = COALESCE(NULLIF(p_comment, ''), comment, ''),
        acted_at = COALESCE(acted_at, now())
    FROM public.approval_nodes n
    JOIN public.approval_instances i ON i.id = n.instance_id
    WHERE a.node_id = n.id
      AND i.target_type = 'timesheet'
      AND i.target_id = p_timesheet_id
      AND i.status = 'running'
      AND a.status = 'pending';

    UPDATE public.approval_nodes n
    SET status = 'cancelled',
        result_action = COALESCE(result_action, p_action),
        comment = COALESCE(NULLIF(p_comment, ''), comment, ''),
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    FROM public.approval_instances i
    WHERE i.id = n.instance_id
      AND i.target_type = 'timesheet'
      AND i.target_id = p_timesheet_id
      AND i.status = 'running'
      AND n.status IN (
        'waiting', 'pending', 'active', 'approved', 'rejected', 'skipped',
        'waiting_revision', 'revision_required', 'needs_revision', 'needs_reapproval'
      );

    UPDATE public.approval_rounds r
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    FROM public.approval_instances i
    WHERE r.instance_id = i.id
      AND i.target_type = 'timesheet'
      AND i.target_id = p_timesheet_id
      AND i.status = 'running';

    UPDATE public.approval_instances
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, now()),
        updated_at = now()
    WHERE target_type = 'timesheet'
      AND target_id = p_timesheet_id
      AND status = 'running';

    UPDATE public.business_documents
    SET lifecycle_status = CASE WHEN p_action = 'withdraw' THEN 'draft' ELSE 'cancelled' END,
        submitted_at = CASE WHEN p_action = 'withdraw' THEN NULL ELSE submitted_at END,
        approved_at = NULL,
        cancelled_at = CASE WHEN p_action = 'withdraw' THEN NULL ELSE now() END,
        updated_at = now()
    WHERE document_type = 'timesheet'
      AND business_id = p_timesheet_id
      AND business_version = 1;

    UPDATE public.timesheets
    SET status = 'draft',
        submitted_at = NULL,
        approved_by = NULL,
        approved_at = NULL,
        review_comment = CASE
          WHEN NULLIF(p_comment, '') IS NULL THEN review_comment
          ELSE p_comment
        END,
        updated_at = now()
    WHERE id = p_timesheet_id;

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

ALTER FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_timesheet_action(bigint, text, text, bigint) TO authenticated;
GRANT SELECT ON public.approval_project_review_records_view TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
