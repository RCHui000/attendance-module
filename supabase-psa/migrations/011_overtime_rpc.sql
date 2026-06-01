BEGIN;

CREATE OR REPLACE FUNCTION psa_overtime_action(
    p_overtime_id BIGINT,
    p_action      TEXT,
    p_comment     TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $func$
DECLARE
    v_user_id   BIGINT;
    v_ot_status TEXT;
    v_new       TEXT;
    v_now       TIMESTAMPTZ := NOW();
BEGIN
    v_user_id := current_employee_id();
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'message', 'Not authenticated');
    END IF;
    IF NOT current_user_can_review() THEN
        RETURN jsonb_build_object('ok', false, 'message', 'Cannot review overtime');
    END IF;

    SELECT status INTO v_ot_status FROM overtime_entries WHERE id = p_overtime_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'message', 'Overtime entry not found');
    END IF;

    IF p_action = 'approve' THEN
        IF v_ot_status != 'pending' THEN
            RETURN jsonb_build_object('ok', false, 'message', 'Already processed');
        END IF;
        v_new := 'approved';
    ELSIF p_action = 'reject' THEN
        IF v_ot_status != 'pending' THEN
            RETURN jsonb_build_object('ok', false, 'message', 'Already processed');
        END IF;
        v_new := 'rejected';
    ELSE
        RETURN jsonb_build_object('ok', false, 'message', 'Unknown action');
    END IF;

    UPDATE workflow_tasks
       SET status = 'completed', completed_by = v_user_id, completed_at = v_now,
           result_action = p_action, comment = p_comment
     WHERE workflow_key = 'overtime' AND target_type = 'overtime'
       AND target_id = p_overtime_id AND status = 'pending';

    UPDATE overtime_entries
       SET status = v_new,
           approved_by = CASE WHEN p_action = 'approve' THEN v_user_id ELSE NULL END,
           approved_at = CASE WHEN p_action = 'approve' THEN v_now ELSE NULL END,
           reject_comment = CASE WHEN p_action = 'reject' THEN p_comment ELSE '' END
     WHERE id = p_overtime_id;

    INSERT INTO approval_logs (target_type, target_id, actor_id, action, comment, from_status, to_status)
    VALUES ('overtime', p_overtime_id, v_user_id, p_action, p_comment, v_ot_status, v_new);

    RETURN jsonb_build_object('ok', true, 'status', v_new);
END;
$func$;

GRANT EXECUTE ON FUNCTION psa_overtime_action(BIGINT, TEXT, TEXT) TO authenticated;

COMMIT;
