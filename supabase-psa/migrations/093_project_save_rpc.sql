BEGIN;

CREATE OR REPLACE FUNCTION public.psa_save_project(
  p_project jsonb,
  p_department_owners jsonb DEFAULT '[]'::jsonb,
  p_project_roles jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_project_id bigint := NULLIF(p_project ->> 'id', '')::bigint;
  v_code text := btrim(COALESCE(p_project ->> 'code', ''));
  v_existing bigint;
BEGIN
  IF NOT public.current_user_can_access_resource('report', 'write') THEN
    RAISE EXCEPTION 'Missing report write permission';
  END IF;

  IF v_code = '' THEN
    RAISE EXCEPTION 'Project code is required';
  END IF;

  SELECT id INTO v_existing
  FROM public.projects
  WHERE code = v_code
    AND COALESCE(status, 'active') <> 'deleted'
    AND (v_project_id IS NULL OR id <> v_project_id)
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Project code already exists: %', v_code;
  END IF;

  IF v_project_id IS NULL THEN
    INSERT INTO public.projects(
      code, name, signed_date, business_type, contract_amount, received_amount,
      owner_org_id, project_owner_id, status
    )
    VALUES (
      v_code,
      p_project ->> 'name',
      NULLIF(p_project ->> 'signed_date', '')::date,
      NULLIF(p_project ->> 'business_type', ''),
      COALESCE(NULLIF(p_project ->> 'contract_amount', '')::numeric, 0),
      COALESCE(NULLIF(p_project ->> 'received_amount', '')::numeric, 0),
      NULLIF(p_project ->> 'owner_org_id', '')::bigint,
      NULLIF(p_project ->> 'project_owner_id', '')::bigint,
      'active'
    )
    RETURNING id INTO v_project_id;
  ELSE
    UPDATE public.projects
    SET code = v_code,
        name = p_project ->> 'name',
        signed_date = NULLIF(p_project ->> 'signed_date', '')::date,
        business_type = NULLIF(p_project ->> 'business_type', ''),
        contract_amount = COALESCE(NULLIF(p_project ->> 'contract_amount', '')::numeric, 0),
        received_amount = COALESCE(NULLIF(p_project ->> 'received_amount', '')::numeric, 0),
        owner_org_id = NULLIF(p_project ->> 'owner_org_id', '')::bigint,
        project_owner_id = NULLIF(p_project ->> 'project_owner_id', '')::bigint,
        status = 'active'
    WHERE id = v_project_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Project not found';
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'project_id', v_project_id);
END;
$$;

REVOKE ALL ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_save_project(jsonb, jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
