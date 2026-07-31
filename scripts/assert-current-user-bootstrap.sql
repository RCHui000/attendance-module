\set ON_ERROR_STOP on
\pset pager off

BEGIN;

DO $$
DECLARE
  v_actor record;
  v_payload record;
  v_expected_permissions jsonb;
  v_expected_sidebar_order jsonb;
BEGIN
  SELECT e.id, e.auth_user_id, COALESCE(ur.role, 'employee') AS role
    INTO v_actor
  FROM public.employees e
  LEFT JOIN public.employee_profiles ep ON ep.employee_id = e.id
  LEFT JOIN LATERAL (
    SELECT user_role.role
    FROM public.user_roles user_role
    LEFT JOIN public.permission_roles permission_role
      ON permission_role.role_key = user_role.role
    WHERE user_role.employee_id = e.id
    ORDER BY COALESCE(permission_role.sort_order, 0) DESC, user_role.role DESC
    LIMIT 1
  ) ur ON true
  WHERE e.auth_user_id IS NOT NULL
    AND COALESCE(e.is_active, true) = true
    AND lower(COALESCE(ep.employment_status, 'active')) NOT IN (
      'terminated', 'inactive', 'resigned', '离职', '已离职'
    )
  ORDER BY e.id
  LIMIT 1;

  IF v_actor.id IS NULL THEN
    RAISE EXCEPTION 'Missing active authenticated employee fixture';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor.auth_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_actor.auth_user_id, 'role', 'authenticated')::text,
    true
  );

  SELECT * INTO v_payload FROM public.psa_current_user_bootstrap();

  IF v_payload.id IS DISTINCT FROM v_actor.id
     OR v_payload.role IS DISTINCT FROM v_actor.role
     OR v_payload.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'Bootstrap identity mismatch: expected id=% role=%, got id=% role=% active=%',
      v_actor.id,
      v_actor.role,
      v_payload.id,
      v_payload.role,
      v_payload.is_active;
  END IF;

  SELECT COALESCE(
    jsonb_object_agg(rp.resource_key, COALESCE(rp.access_level, 'none') ORDER BY rp.resource_key),
    '{}'::jsonb
  )
    INTO v_expected_permissions
  FROM public.role_permissions rp
  WHERE rp.role_key = v_actor.role;

  SELECT COALESCE(
    jsonb_object_agg(
      rp.resource_key,
      COALESCE(rp.sidebar_order, resource.sort_order, 0)
      ORDER BY resource.sort_order, rp.resource_key
    ),
    '{}'::jsonb
  )
    INTO v_expected_sidebar_order
  FROM public.role_permissions rp
  JOIN public.permission_resources resource
    ON resource.resource_key = rp.resource_key
   AND resource.resource_group = 'sidebar'
   AND resource.is_active = true
  WHERE rp.role_key = v_actor.role;

  IF v_payload.permissions IS DISTINCT FROM v_expected_permissions THEN
    RAISE EXCEPTION 'Bootstrap permission payload mismatch';
  END IF;
  IF v_payload.sidebar_order IS DISTINCT FROM v_expected_sidebar_order THEN
    RAISE EXCEPTION 'Bootstrap sidebar-order payload mismatch';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}',
    true
  );
  IF EXISTS (SELECT 1 FROM public.psa_current_user_bootstrap()) THEN
    RAISE EXCEPTION 'Unknown auth subject must not receive a bootstrap payload';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.psa_current_user_bootstrap()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated is missing bootstrap RPC execute privilege';
  END IF;
  IF has_function_privilege('anon', 'public.psa_current_user_bootstrap()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute bootstrap RPC';
  END IF;

  RAISE NOTICE 'Current-user bootstrap RPC assertion passed';
END;
$$;

ROLLBACK;
