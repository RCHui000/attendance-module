-- V0.12: allow browser-admin employee creation through PostgREST.

BEGIN;

DROP POLICY IF EXISTS "Admin all profiles v2" ON employee_profiles_v2;
CREATE POLICY "Admin all profiles v2" ON employee_profiles_v2
  FOR ALL TO authenticated
  USING (current_user_has_role('admin'))
  WITH CHECK (current_user_has_role('admin'));

DROP POLICY IF EXISTS "Admin all contracts" ON employee_contracts;
CREATE POLICY "Admin all contracts" ON employee_contracts
  FOR ALL TO authenticated
  USING (current_user_has_role('admin'))
  WITH CHECK (current_user_has_role('admin'));

DROP POLICY IF EXISTS "Admin all salary" ON employee_salary_profiles;
CREATE POLICY "Admin all salary" ON employee_salary_profiles
  FOR ALL TO authenticated
  USING (current_user_has_role('admin'))
  WITH CHECK (current_user_has_role('admin'));

COMMIT;
