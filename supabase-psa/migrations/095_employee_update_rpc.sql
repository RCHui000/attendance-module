BEGIN;

CREATE OR REPLACE FUNCTION public.psa_update_employee(p_employee jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id bigint := NULLIF(p_employee ->> 'id', '')::bigint;
  v_contract_type text := COALESCE(NULLIF(p_employee ->> 'contract_type', ''), 'labor');
  v_next_role text := COALESCE(NULLIF(p_employee ->> 'role', ''), 'employee');
  v_current_employee_id bigint := public.current_employee_id();
BEGIN
  IF NOT public.current_user_can_access_resource('system_management', 'write') THEN
    RAISE EXCEPTION 'Missing system management write permission';
  END IF;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Employee id is required';
  END IF;

  UPDATE public.employees
  SET name = p_employee ->> 'name',
      employee_no = COALESCE(NULLIF(p_employee ->> 'employee_no', ''), employee_no),
      is_active = COALESCE(NULLIF(p_employee ->> 'status', ''), 'active') <> 'terminated'
  WHERE id = v_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  INSERT INTO public.employee_profiles(
    employee_id, org_id, position_name, cost_specialty, employment_status,
    manager_user_id, hire_date
  )
  VALUES (
    v_id,
    NULLIF(p_employee ->> 'org_id', '')::bigint,
    COALESCE(p_employee ->> 'position_name', ''),
    NULLIF(p_employee ->> 'cost_specialty', ''),
    COALESCE(NULLIF(p_employee ->> 'status', ''), 'active'),
    NULLIF(p_employee ->> 'manager_user_id', '')::bigint,
    NULLIF(p_employee ->> 'hire_date', '')::date
  )
  ON CONFLICT (employee_id) DO UPDATE
  SET org_id = EXCLUDED.org_id,
      position_name = EXCLUDED.position_name,
      cost_specialty = EXCLUDED.cost_specialty,
      employment_status = EXCLUDED.employment_status,
      manager_user_id = EXCLUDED.manager_user_id,
      hire_date = EXCLUDED.hire_date;

  UPDATE public.employee_contracts SET is_current = false WHERE employee_id = v_id;
  INSERT INTO public.employee_contracts(employee_id, contract_type, employment_type, is_current)
  VALUES (
    v_id,
    v_contract_type,
    COALESCE(NULLIF(p_employee ->> 'employment_type', ''), 'labor'),
    true
  );

  UPDATE public.employee_salary_profiles SET is_current = false WHERE employee_id = v_id;
  INSERT INTO public.employee_salary_profiles(
    employee_id, salary_mode, monthly_salary, daily_wage, is_current
  )
  VALUES (
    v_id,
    CASE WHEN v_contract_type = 'service' THEN 'daily_wage' ELSE 'monthly_salary' END,
    CASE WHEN v_contract_type = 'service' THEN 0 ELSE COALESCE(NULLIF(p_employee ->> 'monthly_salary', '')::numeric, 0) END,
    CASE WHEN v_contract_type = 'service' THEN COALESCE(NULLIF(p_employee ->> 'daily_wage', '')::numeric, 0) ELSE 0 END,
    true
  );

  IF (p_employee ? 'role') AND public.current_user_can_access_resource('permission_config', 'write') THEN
    IF v_current_employee_id = v_id AND v_next_role <> 'admin' THEN
      RAISE EXCEPTION 'Cannot remove admin role from current user';
    END IF;

    INSERT INTO public.user_roles(employee_id, role)
    VALUES (v_id, v_next_role)
    ON CONFLICT ON CONSTRAINT user_roles_employee_id_role_key DO NOTHING;

    DELETE FROM public.user_roles
    WHERE employee_id = v_id
      AND role <> v_next_role;
  END IF;

  RETURN jsonb_build_object('ok', true, 'employee_id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.psa_update_employee(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.psa_update_employee(jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
