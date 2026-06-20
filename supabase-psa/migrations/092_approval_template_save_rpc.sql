BEGIN;

CREATE OR REPLACE FUNCTION public.psa_save_approval_template(
  p_template_id bigint,
  p_name text,
  p_status text,
  p_version integer,
  p_nodes jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_node jsonb;
BEGIN
  IF NOT public.current_user_has_role('admin') THEN
    RAISE EXCEPTION 'Only admin can edit approval templates';
  END IF;

  IF p_template_id IS NULL OR p_template_id <= 0 THEN
    RAISE EXCEPTION 'Template id is required';
  END IF;

  UPDATE public.approval_templates
  SET name = p_name,
      status = COALESCE(NULLIF(p_status, ''), 'active'),
      version = COALESCE(p_version, 1)
  WHERE id = p_template_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval template not found';
  END IF;

  FOR v_node IN SELECT * FROM jsonb_array_elements(COALESCE(p_nodes, '[]'::jsonb))
  LOOP
    UPDATE public.approval_template_nodes
    SET node_name = v_node ->> 'node_name',
        resolver_type = v_node ->> 'resolver_type',
        resolver_role = NULLIF(v_node ->> 'resolver_role', ''),
        approval_policy = COALESCE(NULLIF(v_node ->> 'approval_policy', ''), 'single'),
        reject_policy = COALESCE(NULLIF(v_node ->> 'reject_policy', ''), 'back_to_creator'),
        sort_order = COALESCE((v_node ->> 'sort_order')::integer, 0)
    WHERE id = (v_node ->> 'id')::bigint
      AND template_id = p_template_id;
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.psa_save_approval_template(bigint, text, text, integer, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_approval_template(bigint, text, text, integer, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
