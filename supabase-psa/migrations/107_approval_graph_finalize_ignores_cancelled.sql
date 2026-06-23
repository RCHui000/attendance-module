BEGIN;

CREATE OR REPLACE FUNCTION public.psa_finalize_approval_instance_if_complete(
  p_instance_id bigint,
  p_actor_user_id bigint DEFAULT NULL::bigint,
  p_request_id text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_instance public.approval_instances%rowtype;
  v_actor bigint := COALESCE(p_actor_user_id, public.current_employee_id());
  v_last_approver bigint;
  v_effective_node_count int;
  v_unfinished_node_count int;
  v_completed_at timestamptz;
BEGIN
  SELECT *
    INTO v_instance
    FROM public.approval_instances
   WHERE id = p_instance_id
   FOR UPDATE;

  IF v_instance.id IS NULL OR v_instance.status <> 'running' THEN
    RETURN false;
  END IF;

  SELECT
    count(*) FILTER (WHERE n.status <> 'cancelled')::int,
    count(*) FILTER (
      WHERE n.status <> 'cancelled'
        AND n.status NOT IN ('approved', 'skipped')
    )::int,
    max(n.completed_at) FILTER (WHERE n.status IN ('approved', 'skipped'))
    INTO v_effective_node_count, v_unfinished_node_count, v_completed_at
    FROM public.approval_nodes n
   WHERE n.instance_id = p_instance_id;

  IF COALESCE(v_effective_node_count, 0) = 0 OR COALESCE(v_unfinished_node_count, 0) <> 0 THEN
    RETURN false;
  END IF;

  SELECT COALESCE(a.assignee_user_id, n.assignee_user_id)
    INTO v_last_approver
    FROM public.approval_nodes n
    LEFT JOIN public.approval_node_assignees a
      ON a.node_id = n.id
     AND a.status = 'approved'
   WHERE n.instance_id = p_instance_id
     AND n.status = 'approved'
   ORDER BY COALESCE(a.acted_at, n.completed_at, n.updated_at, n.created_at) DESC NULLS LAST, n.id DESC
   LIMIT 1;

  v_actor := COALESCE(v_actor, v_last_approver, v_instance.created_by);
  v_completed_at := COALESCE(v_completed_at, now());

  UPDATE public.approval_rounds
     SET status = 'approved',
         completed_at = COALESCE(completed_at, v_completed_at),
         updated_at = now()
   WHERE id = v_instance.current_round_id
     AND status = 'running';

  UPDATE public.approval_instances
     SET status = 'approved',
         completed_at = COALESCE(completed_at, v_completed_at),
         updated_at = now()
   WHERE id = p_instance_id
     AND status = 'running';

  UPDATE public.business_documents
     SET lifecycle_status = 'approved',
         approved_at = COALESCE(approved_at, v_completed_at),
         updated_at = now()
   WHERE id = v_instance.document_id
     AND lifecycle_status <> 'approved';

  IF v_instance.target_type = 'timesheet' THEN
    UPDATE public.timesheets
       SET status = 'approved',
           approved_by = COALESCE(approved_by, v_actor),
           approved_at = COALESCE(approved_at, v_completed_at),
           updated_at = now()
     WHERE id = v_instance.target_id
       AND status = 'submitted';
  END IF;

  PERFORM public.psa_write_approval_event(
    v_instance.id,
    v_instance.current_round_id,
    NULL,
    NULL,
    v_actor,
    'document_approved',
    'in_approval',
    'approved',
    p_request_id,
    'Approval graph finalized after all effective nodes completed',
    jsonb_build_object('source', 'psa_finalize_approval_instance_if_complete')
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_node(
  p_node_id bigint,
  p_actor_user_id bigint DEFAULT NULL::bigint,
  p_comment text DEFAULT ''::text,
  p_request_id text DEFAULT NULL::text
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
BEGIN
  SELECT * INTO v_node FROM public.approval_nodes WHERE id = p_node_id FOR UPDATE;
  IF v_node.id IS NULL OR v_node.status <> 'active' THEN
    RAISE EXCEPTION 'Node is not active';
  END IF;

  SELECT * INTO v_assignee
    FROM public.approval_node_assignees
   WHERE node_id = p_node_id
     AND assignee_user_id = v_actor
     AND status = 'pending'
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
     SET status = 'approved',
         action = 'approve',
         comment = COALESCE(p_comment, ''),
         acted_at = now()
   WHERE id = v_assignee.id
     AND status = 'pending';

  PERFORM public.psa_write_approval_event(
    v_node.instance_id, v_node.round_id, v_node.id, v_assignee.id, v_actor,
    'assignee_approved', 'pending', 'approved', p_request_id, p_comment, '{}'::jsonb
  );

  IF v_node.approval_policy IN ('single', 'any') THEN
    UPDATE public.approval_node_assignees
       SET status = 'cancelled',
           action = 'cancelled',
           acted_at = now()
     WHERE node_id = p_node_id
       AND status = 'pending';
    v_pending_count := 0;
  ELSE
    SELECT count(*) INTO v_pending_count
      FROM public.approval_node_assignees
     WHERE node_id = p_node_id
       AND status = 'pending';
  END IF;

  IF v_pending_count = 0 THEN
    UPDATE public.approval_nodes
       SET status = 'approved',
           result_action = 'approve',
           comment = COALESCE(p_comment, ''),
           completed_at = now(),
           updated_at = now()
     WHERE id = p_node_id
       AND status = 'active';

    PERFORM public.psa_activate_ready_nodes(v_node.round_id);
  END IF;

  PERFORM public.psa_finalize_approval_instance_if_complete(
    v_node.instance_id,
    v_actor,
    p_request_id
  );

  RETURN jsonb_build_object('ok', true, 'node_id', p_node_id);
END;
$$;

WITH stuck AS (
  SELECT i.id AS instance_id
  FROM public.approval_instances i
  JOIN public.timesheets t ON t.id = i.target_id
  JOIN public.approval_nodes n ON n.instance_id = i.id
  WHERE i.target_type = 'timesheet'
    AND i.status = 'running'
    AND t.status = 'submitted'
  GROUP BY i.id
  HAVING count(n.id) FILTER (WHERE n.status <> 'cancelled') > 0
     AND count(n.id) FILTER (
       WHERE n.status <> 'cancelled'
         AND n.status NOT IN ('approved', 'skipped')
     ) = 0
)
SELECT public.psa_finalize_approval_instance_if_complete(
  stuck.instance_id,
  NULL,
  'migration:107'
)
FROM stuck;

REVOKE ALL ON FUNCTION public.psa_finalize_approval_instance_if_complete(bigint, bigint, text)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_node(bigint, bigint, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_node(bigint, bigint, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
