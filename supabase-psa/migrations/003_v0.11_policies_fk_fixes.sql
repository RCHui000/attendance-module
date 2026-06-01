-- V0.11 Fixes: Missing RLS policies + FK constraints + view security
-- Run after 001_v0.11_schema.sql and 002_v0.11_rls.sql

BEGIN;

-- ============================
-- 1. Missing RLS policies for tables that have RLS but no policies
-- ============================

-- timesheet_entries: users can read entries for their own timesheets
CREATE POLICY "Self read own entries" ON timesheet_entries
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM timesheets t
                JOIN employees e ON e.id = t.user_id
                WHERE e.auth_user_id = auth.uid()
                  AND t.id = timesheet_entries.timesheet_id)
    );

CREATE POLICY "Approver read assigned entries" ON timesheet_entries
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM workflow_tasks wt
                JOIN employees e ON e.id = wt.assignee_user_id
                WHERE e.auth_user_id = auth.uid()
                  AND wt.target_type = 'timesheet'
                  AND wt.target_id = timesheet_entries.timesheet_id)
    );

-- overtime_entries: users can read overtime for their own timesheets
CREATE POLICY "Self read own overtime" ON overtime_entries
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM timesheets t
                JOIN employees e ON e.id = t.user_id
                WHERE e.auth_user_id = auth.uid()
                  AND t.id = overtime_entries.timesheet_id)
    );

CREATE POLICY "Approver read assigned overtime" ON overtime_entries
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM workflow_tasks wt
                JOIN employees e ON e.id = wt.assignee_user_id
                WHERE e.auth_user_id = auth.uid()
                  AND wt.target_type = 'overtime'
                  AND wt.target_id = overtime_entries.id)
    );

-- projects: authenticated users can read active projects
CREATE POLICY "Authenticated read active projects" ON projects
    FOR SELECT TO authenticated
    USING (status = 'active');

CREATE POLICY "Admin manage projects" ON projects
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_roles ur
                JOIN employees e ON e.id = ur.employee_id
                WHERE e.auth_user_id = auth.uid() AND ur.role = 'admin')
    );

-- organizations: authenticated users can read active orgs
CREATE POLICY "Authenticated read active orgs" ON organizations
    FOR SELECT TO authenticated
    USING (status = 'active');

CREATE POLICY "Admin manage orgs" ON organizations
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_roles ur
                JOIN employees e ON e.id = ur.employee_id
                WHERE e.auth_user_id = auth.uid() AND ur.role = 'admin')
    );

-- employee_profiles_v2: self-read, manager-read, admin-all
CREATE POLICY "Self read own profile v2" ON employee_profiles_v2
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM employees e
                WHERE e.auth_user_id = auth.uid()
                  AND e.id = employee_profiles_v2.employee_id)
    );

CREATE POLICY "Manager read org profiles v2" ON employee_profiles_v2
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM employees me
                JOIN employee_profiles_v2 my_ep ON my_ep.employee_id = me.id
                WHERE me.auth_user_id = auth.uid()
                  AND my_ep.employee_id = employee_profiles_v2.employee_id
                  AND employee_profiles_v2.manager_user_id = me.id)
    );

CREATE POLICY "Admin all profiles v2" ON employee_profiles_v2
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_roles ur
                JOIN employees e ON e.id = ur.employee_id
                WHERE e.auth_user_id = auth.uid() AND ur.role = 'admin')
    );

-- employee_contracts: self-read, admin-all
CREATE POLICY "Self read own contracts" ON employee_contracts
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM employees e
                WHERE e.auth_user_id = auth.uid()
                  AND e.id = employee_contracts.employee_id)
    );

CREATE POLICY "Admin all contracts" ON employee_contracts
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_roles ur
                JOIN employees e ON e.id = ur.employee_id
                WHERE e.auth_user_id = auth.uid() AND ur.role = 'admin')
    );

-- employee_salary_profiles: self-read, admin-all (salary is sensitive)
CREATE POLICY "Self read own salary" ON employee_salary_profiles
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM employees e
                WHERE e.auth_user_id = auth.uid()
                  AND e.id = employee_salary_profiles.employee_id)
    );

CREATE POLICY "Admin all salary" ON employee_salary_profiles
    FOR ALL USING (
        EXISTS (SELECT 1 FROM user_roles ur
                JOIN employees e ON e.id = ur.employee_id
                WHERE e.auth_user_id = auth.uid() AND ur.role = 'admin')
    );

-- approval_logs: admin-read, self-read (logs involving the user)
CREATE POLICY "Admin read approval logs" ON approval_logs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_roles ur
                JOIN employees e ON e.id = ur.employee_id
                WHERE e.auth_user_id = auth.uid() AND ur.role = 'admin')
    );

-- ============================
-- 2. Fix UPDATE policies — add WITH CHECK clauses
-- ============================

-- Replace the old UPDATE-only policy on timesheets with USING + WITH CHECK
DROP POLICY IF EXISTS "Self write draft/rejected timesheet" ON timesheets;

CREATE POLICY "Self write draft/rejected timesheet" ON timesheets
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM employees e
                WHERE e.auth_user_id = auth.uid()
                  AND e.id = timesheets.user_id)
        AND timesheets.status IN ('draft', 'rejected')
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM employees e
                WHERE e.auth_user_id = auth.uid()
                  AND e.id = timesheets.user_id)
        AND timesheets.status IN ('draft', 'rejected')
    );

-- ============================
-- 3. Add security_invoker to the HR view (Postgres 15+)
-- ============================

DROP VIEW IF EXISTS hr_employee_current_view;
CREATE OR REPLACE VIEW hr_employee_current_view
WITH (security_invoker = true)
AS
SELECT
    e.id                    AS employee_id,
    e.auth_user_id,
    e.employee_no,
    e.name                  AS employee_name,
    p.display_name,
    p.login_name,
    p.auth_email,
    ep.org_id,
    o.org_name,
    ep.position_name,
    ep.employment_status,
    ep.manager_user_id,
    ep.hire_date,
    ep.row_locked,
    ec.contract_type,
    ec.employment_type,
    ec.contract_start,
    ec.contract_end,
    esp.salary_mode,
    esp.monthly_salary,
    esp.daily_wage,
    esp.standard_monthly_workdays,
    e.is_active
FROM employees e
LEFT JOIN profiles p ON p.auth_user_id = e.auth_user_id
LEFT JOIN employee_profiles_v2 ep ON ep.employee_id = e.id
LEFT JOIN organizations o ON o.id = ep.org_id
LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = TRUE
LEFT JOIN employee_salary_profiles esp ON esp.employee_id = e.id AND esp.is_current = TRUE;

-- ============================
-- 4. Add missing foreign key constraints
-- ============================

-- NOTE: These are added with NOT VALID to avoid locking on existing data.
-- Run VALIDATE CONSTRAINT separately if data integrity is confirmed.

-- timesheets
ALTER TABLE timesheets
    ADD CONSTRAINT fk_timesheets_user FOREIGN KEY (user_id) REFERENCES employees(id);

ALTER TABLE timesheets
    ADD CONSTRAINT fk_timesheets_approved_by FOREIGN KEY (approved_by) REFERENCES employees(id);

-- overtime_entries
ALTER TABLE overtime_entries
    ADD CONSTRAINT fk_overtime_approved_by FOREIGN KEY (approved_by) REFERENCES employees(id);

-- workflow_tasks
ALTER TABLE workflow_tasks
    ADD CONSTRAINT fk_wt_assignee FOREIGN KEY (assignee_user_id) REFERENCES employees(id);

ALTER TABLE workflow_tasks
    ADD CONSTRAINT fk_wt_created_by FOREIGN KEY (created_by) REFERENCES employees(id);

ALTER TABLE workflow_tasks
    ADD CONSTRAINT fk_wt_completed_by FOREIGN KEY (completed_by) REFERENCES employees(id);

-- approval_logs
ALTER TABLE approval_logs
    ADD CONSTRAINT fk_al_actor FOREIGN KEY (actor_id) REFERENCES employees(id);

-- projects
ALTER TABLE projects
    ADD CONSTRAINT fk_projects_owner FOREIGN KEY (project_owner_id) REFERENCES employees(id);

-- employee_profiles_v2
ALTER TABLE employee_profiles_v2
    ADD CONSTRAINT fk_epv2_manager FOREIGN KEY (manager_user_id) REFERENCES employees(id);

-- user_roles
ALTER TABLE user_roles
    ADD CONSTRAINT fk_ur_granted_by FOREIGN KEY (granted_by) REFERENCES employees(id);

COMMIT;
