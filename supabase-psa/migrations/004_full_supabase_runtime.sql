-- V0.12: Browser/PostgREST runtime support.
-- The browser uses GoTrue and PostgREST directly for business operations.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Tables migrated from SQLite used explicit BIGINT ids. Give new rows safe defaults.
CREATE SEQUENCE IF NOT EXISTS organizations_id_seq;
CREATE SEQUENCE IF NOT EXISTS projects_id_seq;
CREATE SEQUENCE IF NOT EXISTS timesheets_id_seq;
CREATE SEQUENCE IF NOT EXISTS timesheet_entries_id_seq;
CREATE SEQUENCE IF NOT EXISTS overtime_entries_id_seq;

SELECT setval('organizations_id_seq', COALESCE((SELECT MAX(id) FROM organizations), 0) + 1, false);
SELECT setval('projects_id_seq', COALESCE((SELECT MAX(id) FROM projects), 0) + 1, false);
SELECT setval('timesheets_id_seq', COALESCE((SELECT MAX(id) FROM timesheets), 0) + 1, false);
SELECT setval('timesheet_entries_id_seq', COALESCE((SELECT MAX(id) FROM timesheet_entries), 0) + 1, false);
SELECT setval('overtime_entries_id_seq', COALESCE((SELECT MAX(id) FROM overtime_entries), 0) + 1, false);

ALTER TABLE organizations ALTER COLUMN id SET DEFAULT nextval('organizations_id_seq');
ALTER TABLE projects ALTER COLUMN id SET DEFAULT nextval('projects_id_seq');
ALTER TABLE timesheets ALTER COLUMN id SET DEFAULT nextval('timesheets_id_seq');
ALTER TABLE timesheet_entries ALTER COLUMN id SET DEFAULT nextval('timesheet_entries_id_seq');
ALTER TABLE overtime_entries ALTER COLUMN id SET DEFAULT nextval('overtime_entries_id_seq');

-- Utility role checks.
CREATE OR REPLACE FUNCTION current_employee_id()
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
  SELECT id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION current_user_has_role(role_name TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN employees e ON e.id = ur.employee_id
    WHERE e.auth_user_id = auth.uid()
      AND ur.role = role_name
  )
$$;

CREATE OR REPLACE FUNCTION current_user_can_review()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT current_user_has_role('admin') OR current_user_has_role('manager')
$$;

-- User role visibility is required for the browser to compute permissions.
CREATE POLICY "Self read roles" ON user_roles
  FOR SELECT TO authenticated
  USING (employee_id = current_employee_id());

CREATE POLICY "Admin all roles" ON user_roles
  FOR ALL TO authenticated
  USING (current_user_has_role('admin'))
  WITH CHECK (current_user_has_role('admin'));

-- Reports and project dashboards are part of the manager/admin surface.
CREATE POLICY "Reviewer read employees" ON employees
  FOR SELECT TO authenticated
  USING (current_user_can_review());

CREATE POLICY "Reviewer read profiles" ON employee_profiles
  FOR SELECT TO authenticated
  USING (current_user_can_review());

CREATE POLICY "Reviewer read contracts" ON employee_contracts
  FOR SELECT TO authenticated
  USING (current_user_can_review());

CREATE POLICY "Reviewer read salary" ON employee_salary_profiles
  FOR SELECT TO authenticated
  USING (current_user_can_review());

CREATE POLICY "Reviewer read timesheets" ON timesheets
  FOR SELECT TO authenticated
  USING (current_user_can_review());

CREATE POLICY "Reviewer read entries" ON timesheet_entries
  FOR SELECT TO authenticated
  USING (current_user_can_review());

CREATE POLICY "Reviewer read overtime" ON overtime_entries
  FOR SELECT TO authenticated
  USING (current_user_can_review());

-- Self-service weekly timesheet editing through PostgREST.
CREATE POLICY "Self insert timesheet" ON timesheets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = current_employee_id());

DROP POLICY IF EXISTS "Self write draft/rejected timesheet" ON timesheets;
CREATE POLICY "Self update draft rejected timesheet" ON timesheets
  FOR UPDATE TO authenticated
  USING (user_id = current_employee_id() AND status IN ('draft', 'rejected'))
  WITH CHECK (user_id = current_employee_id());

CREATE POLICY "Self insert entries" ON timesheet_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM timesheets t
      WHERE t.id = timesheet_entries.timesheet_id
        AND t.user_id = current_employee_id()
        AND t.status IN ('draft', 'rejected')
    )
  );

CREATE POLICY "Self delete draft entries" ON timesheet_entries
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM timesheets t
      WHERE t.id = timesheet_entries.timesheet_id
        AND t.user_id = current_employee_id()
        AND t.status IN ('draft', 'rejected')
    )
  );

CREATE POLICY "Self insert overtime" ON overtime_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM timesheets t
      WHERE t.id = overtime_entries.timesheet_id
        AND t.user_id = current_employee_id()
        AND t.status IN ('draft', 'rejected')
    )
  );

CREATE POLICY "Self delete draft overtime" ON overtime_entries
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM timesheets t
      WHERE t.id = overtime_entries.timesheet_id
        AND t.user_id = current_employee_id()
        AND t.status IN ('draft', 'rejected')
    )
  );

-- Approval/task mutations from authenticated reviewers.
CREATE POLICY "Self submit own workflow tasks" ON workflow_tasks
  FOR INSERT TO authenticated
  WITH CHECK (created_by = current_employee_id());

CREATE POLICY "Assignee update own tasks" ON workflow_tasks
  FOR UPDATE TO authenticated
  USING (assignee_user_id = current_employee_id() OR current_user_has_role('admin'))
  WITH CHECK (assignee_user_id = current_employee_id() OR current_user_has_role('admin'));

CREATE POLICY "Reviewer insert approval logs" ON approval_logs
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = current_employee_id() AND current_user_can_review());

CREATE POLICY "Reviewer update submitted timesheets" ON timesheets
  FOR UPDATE TO authenticated
  USING (status = 'submitted' AND current_user_can_review())
  WITH CHECK (current_user_can_review());

CREATE POLICY "Reviewer update overtime" ON overtime_entries
  FOR UPDATE TO authenticated
  USING (current_user_can_review())
  WITH CHECK (current_user_can_review());

-- Admin maintenance through the browser.
CREATE POLICY "Admin all employees" ON employees
  FOR ALL TO authenticated
  USING (current_user_has_role('admin'))
  WITH CHECK (current_user_has_role('admin'));

CREATE POLICY "Admin all projects v12" ON projects
  FOR ALL TO authenticated
  USING (current_user_has_role('admin'))
  WITH CHECK (current_user_has_role('admin'));

CREATE POLICY "Admin all orgs v12" ON organizations
  FOR ALL TO authenticated
  USING (current_user_has_role('admin'))
  WITH CHECK (current_user_has_role('admin'));

COMMIT;
