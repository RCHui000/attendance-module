-- V0.16 hotfix: project-block revision rebuilds rejected approval nodes.
-- Preserve approval_events while clearing references to nodes/assignees that
-- are about to be deleted and rebuilt for the revised project.

BEGIN;

CREATE OR REPLACE FUNCTION public.psa_sync_timesheet_project_revisions(
  p_timesheet_id bigint,
  p_revisions jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor bigint := public.current_employee_id();
  v_sheet public.timesheets%rowtype;
  v_instance_id bigint;
  v_round_id bigint;
  v_revision record;
  v_node record;
  v_new_node_id bigint;
  v_previous_node_id bigint;
  v_project_id_for_edges bigint;
  v_inserted int := 0;
  v_changed int := 0;
BEGIN
  SELECT * INTO v_sheet
  FROM public.timesheets
  WHERE id = p_timesheet_id
  FOR UPDATE;

  IF v_sheet.id IS NULL THEN
    RAISE EXCEPTION 'Timesheet not found';
  END IF;
  IF v_sheet.user_id <> v_actor THEN
    RAISE EXCEPTION 'Cannot revise another employee timesheet';
  END IF;
  IF v_sheet.status <> 'submitted' THEN
    RAISE EXCEPTION 'Project revisions are only supported for submitted timesheets';
  END IF;
  IF NOT public.current_user_can_access_resource('timesheet', 'write') THEN
    RAISE EXCEPTION 'Missing timesheet write permission';
  END IF;

  SELECT i.id, i.current_round_id INTO v_instance_id, v_round_id
  FROM public.approval_instances i
  WHERE i.target_type = 'timesheet'
    AND i.target_id = p_timesheet_id
    AND i.status = 'running'
  LIMIT 1;

  IF v_instance_id IS NULL OR v_round_id IS NULL THEN
    RAISE EXCEPTION 'No running approval graph found for timesheet';
  END IF;

  FOR v_revision IN
    SELECT
      NULLIF((item ->> 'old_project_id')::bigint, 0) AS old_project_id,
      NULLIF((item ->> 'new_project_id')::bigint, 0) AS new_project_id
    FROM jsonb_array_elements(COALESCE(p_revisions, '[]'::jsonb)) AS item
  LOOP
    IF v_revision.old_project_id IS NULL
       OR v_revision.new_project_id IS NULL
       OR v_revision.old_project_id = v_revision.new_project_id THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.approval_nodes n
      WHERE n.round_id = v_round_id
        AND n.scope_type = 'project'
        AND n.scope_id = v_revision.new_project_id
        AND n.status NOT IN ('rejected', 'needs_reapproval', 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Cannot merge a rejected project block into an active or approved project block';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.approval_nodes n
      WHERE n.round_id = v_round_id
        AND n.scope_type = 'project'
        AND n.scope_id = v_revision.old_project_id
        AND n.status = 'rejected'
    ) THEN
      RAISE EXCEPTION 'Original project block is not rejected';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.timesheet_entries te
      WHERE te.timesheet_id = p_timesheet_id
        AND te.project_id = v_revision.new_project_id
        AND COALESCE(te.hours, 0) > 0
    ) THEN
      RAISE EXCEPTION 'Revised project block has no timesheet entries';
    END IF;

    WITH target_nodes AS (
      SELECT n.id
      FROM public.approval_nodes n
      WHERE n.round_id = v_round_id
        AND n.scope_type = 'project'
        AND n.scope_id IN (v_revision.old_project_id, v_revision.new_project_id)
        AND n.status IN ('rejected', 'needs_reapproval', 'cancelled')
    ),
    target_assignees AS (
      SELECT a.id
      FROM public.approval_node_assignees a
      JOIN target_nodes n ON n.id = a.node_id
    )
    UPDATE public.approval_events e
    SET node_id = CASE WHEN e.node_id IN (SELECT id FROM target_nodes) THEN NULL ELSE e.node_id END,
        assignee_id = CASE WHEN e.assignee_id IN (SELECT id FROM target_assignees) THEN NULL ELSE e.assignee_id END
    WHERE e.instance_id = v_instance_id
      AND (
        e.node_id IN (SELECT id FROM target_nodes)
        OR e.assignee_id IN (SELECT id FROM target_assignees)
      );

    DELETE FROM public.approval_nodes n
    WHERE n.round_id = v_round_id
      AND n.scope_type = 'project'
      AND n.scope_id IN (v_revision.old_project_id, v_revision.new_project_id)
      AND n.status IN ('rejected', 'needs_reapproval', 'cancelled');

    v_previous_node_id := NULL;
    v_project_id_for_edges := NULL;
    v_inserted := 0;

    FOR v_node IN
      SELECT *
      FROM public.psa_timesheet_project_approval_chain(p_timesheet_id)
      WHERE project_id = v_revision.new_project_id
      ORDER BY project_id, step_order
    LOOP
      IF v_previous_node_id IS NOT NULL AND v_project_id_for_edges IS DISTINCT FROM v_node.project_id THEN
        v_previous_node_id := NULL;
      END IF;

      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, assignee_user_id, assignee_role, snapshot, metadata
      )
      VALUES (
        v_round_id, v_instance_id, v_node.node_key, 'timesheet_serial_project_review',
        v_node.node_name, 'approval', 'project', v_node.project_id, 'rejected',
        'project_role', v_node.resolver_role, 'single', 'back_to_creator',
        v_node.assignee_user_id, v_node.resolver_role,
        jsonb_build_object(
          'resolved_assignee_user_id', v_node.assignee_user_id,
          'assignee_role', v_node.resolver_role,
          'route_source', v_node.route_source,
          'serial_step_order', v_node.step_order,
          'revised_from_project_id', v_revision.old_project_id
        ),
        jsonb_build_object(
          'project_id', v_node.project_id,
          'optional', true,
          'serial_step_order', v_node.step_order,
          'compressed_serial_chain', true,
          'revised_from_project_id', v_revision.old_project_id
        )
      )
      RETURNING id INTO v_new_node_id;

      IF v_previous_node_id IS NOT NULL THEN
        INSERT INTO public.approval_edges (round_id, instance_id, from_node_id, to_node_id, edge_type, condition_type)
        VALUES (v_round_id, v_instance_id, v_previous_node_id, v_new_node_id, 'normal', 'all_approved')
        ON CONFLICT DO NOTHING;
      END IF;

      v_previous_node_id := v_new_node_id;
      v_project_id_for_edges := v_node.project_id;
      v_inserted := v_inserted + 1;
    END LOOP;

    IF v_inserted = 0 THEN
      INSERT INTO public.approval_nodes (
        round_id, instance_id, node_key, template_node_key, node_name, node_type,
        scope_type, scope_id, status, resolver_type, resolver_role, approval_policy,
        reject_policy, completed_at, result_action, comment, snapshot, metadata
      )
      VALUES (
        v_round_id, v_instance_id, 'project_' || v_revision.new_project_id::text || '_skipped_unresolved',
        'timesheet_serial_project_review', 'Project Review Skipped', 'approval',
        'project', v_revision.new_project_id, 'rejected', 'project_role', 'unresolved_optional',
        'single', 'back_to_creator', NULL, NULL, 'Revised project block pending resubmission; no configured approver yet',
        jsonb_build_object('route_source', 'optional_unresolved_skipped', 'revised_from_project_id', v_revision.old_project_id),
        jsonb_build_object('project_id', v_revision.new_project_id, 'optional', true, 'unresolved_skipped', true, 'revised_from_project_id', v_revision.old_project_id)
      );
    END IF;

    v_changed := v_changed + 1;
  END LOOP;

  IF v_changed > 0 THEN
    UPDATE public.timesheets
    SET updated_at = now()
    WHERE id = p_timesheet_id;

    PERFORM public.psa_write_approval_event(
      v_instance_id,
      v_round_id,
      NULL,
      NULL,
      v_actor,
      'project_block_revised',
      'rejected',
      'rejected',
      'timesheet:' || p_timesheet_id || ':project_revision:' || floor(extract(epoch from clock_timestamp()) * 1000)::text,
      '',
      jsonb_build_object('revisions', p_revisions)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'changed', v_changed);
END;
$$;

ALTER FUNCTION public.psa_sync_timesheet_project_revisions(bigint, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.psa_sync_timesheet_project_revisions(bigint, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_sync_timesheet_project_revisions(bigint, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
