BEGIN;

INSERT INTO public.permission_resources(resource_key, resource_name, resource_group, sort_order, is_active)
VALUES ('approval_config', '审批流配置', 'approval', 10, true)
ON CONFLICT (resource_key) DO UPDATE
SET resource_name = EXCLUDED.resource_name,
    resource_group = EXCLUDED.resource_group,
    sort_order = EXCLUDED.sort_order,
    is_active = true,
    updated_at = now();

INSERT INTO public.role_permissions(role_key, resource_key, access_level)
VALUES ('admin', 'approval_config', 'write')
ON CONFLICT (role_key, resource_key) DO UPDATE
SET access_level = EXCLUDED.access_level,
    updated_at = now();

INSERT INTO public.permission_resource_effects(resource_key, access_level, object_type, object_name, operation, description)
VALUES
  ('approval_config', 'read', 'route', '/review#templates', 'view_approval_template_config', 'View approval-flow template configuration.'),
  ('approval_config', 'read', 'table', 'approval_templates', 'select', 'Read approval templates.'),
  ('approval_config', 'read', 'table', 'approval_template_nodes', 'select', 'Read approval template nodes.'),
  ('approval_config', 'read', 'table', 'approval_template_edges', 'select', 'Read approval template edges.'),
  ('approval_config', 'write', 'rpc', 'psa_save_approval_template', 'update', 'Update approval template metadata and nodes.')
ON CONFLICT (resource_key, access_level, object_type, object_name, operation) DO UPDATE
SET description = EXCLUDED.description,
    updated_at = now();

DROP POLICY IF EXISTS "Authenticated read approval templates" ON public.approval_templates;
DROP POLICY IF EXISTS "RBAC read approval templates" ON public.approval_templates;
CREATE POLICY "RBAC read approval templates" ON public.approval_templates
  FOR SELECT TO authenticated
  USING (public.current_user_can_access_resource('approval_config', 'read'));

DROP POLICY IF EXISTS "Authenticated read approval template nodes" ON public.approval_template_nodes;
DROP POLICY IF EXISTS "RBAC read approval template nodes" ON public.approval_template_nodes;
CREATE POLICY "RBAC read approval template nodes" ON public.approval_template_nodes
  FOR SELECT TO authenticated
  USING (public.current_user_can_access_resource('approval_config', 'read'));

DROP POLICY IF EXISTS "Authenticated read approval template edges" ON public.approval_template_edges;
DROP POLICY IF EXISTS "RBAC read approval template edges" ON public.approval_template_edges;
CREATE POLICY "RBAC read approval template edges" ON public.approval_template_edges
  FOR SELECT TO authenticated
  USING (public.current_user_can_access_resource('approval_config', 'read'));

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
  IF NOT public.current_user_can_access_resource('approval_config', 'write') THEN
    RAISE EXCEPTION 'Missing approval_config write permission' USING ERRCODE = '42501';
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
