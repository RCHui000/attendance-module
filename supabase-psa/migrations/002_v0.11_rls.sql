-- V0.11 RLS Policies
-- Run after 001_v0.11_schema.sql

BEGIN;

-- Enable RLS on core tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_salary_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE overtime_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================
-- Profiles: self-read
-- ============================
CREATE POLICY "Users can read own profile" ON profiles
    FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY "Admin can read all profiles" ON profiles
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_roles ur
                JOIN employees e ON e.id = ur.employee_id
                WHERE e.auth_user_id = auth.uid() AND ur.role = 'admin')
    );

-- ============================
-- Employees: self-read, admin all
-- ============================
CREATE POLICY "Self read employee" ON employees
    FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY "Admin read all employees" ON employees
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_roles ur JOIN employees e ON e.id = ur.employee_id
                WHERE e.auth_user_id = auth.uid() AND ur.role = 'admin')
    );

CREATE POLICY "Manager read org employees" ON employees
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM employee_profiles ep
                JOIN employees me ON me.id = ep.manager_user_id
                WHERE me.auth_user_id = auth.uid()
                  AND ep.employee_id = employees.id)
    );

-- ============================
-- Timesheets: self-read/write, approver read
-- ============================
CREATE POLICY "Self read own timesheet" ON timesheets
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM employees e
                WHERE e.auth_user_id = auth.uid()
                  AND e.id = timesheets.user_id)
    );

CREATE POLICY "Self write draft/rejected timesheet" ON timesheets
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM employees e
                WHERE e.auth_user_id = auth.uid()
                  AND e.id = timesheets.user_id)
        AND timesheets.status IN ('draft', 'rejected')
    );

CREATE POLICY "Approver read assigned timesheet" ON timesheets
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM workflow_tasks wt
                JOIN employees e ON e.id = wt.assignee_user_id
                WHERE e.auth_user_id = auth.uid()
                  AND wt.target_type = 'timesheet'
                  AND wt.target_id = timesheets.id)
    );

-- ============================
-- Workflow tasks: assignee-only or admin
-- ============================
CREATE POLICY "Assignee read own tasks" ON workflow_tasks
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM employees e
                WHERE e.auth_user_id = auth.uid()
                  AND e.id = workflow_tasks.assignee_user_id)
    );

CREATE POLICY "Admin read all tasks" ON workflow_tasks
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_roles ur JOIN employees e ON e.id = ur.employee_id
                WHERE e.auth_user_id = auth.uid() AND ur.role = 'admin')
    );

-- ============================
-- Audit logs: append-only, admin read
-- ============================
CREATE POLICY "Service insert audit" ON audit_logs
    FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "Admin read audit" ON audit_logs
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM user_roles ur JOIN employees e ON e.id = ur.employee_id
                WHERE e.auth_user_id = auth.uid() AND ur.role = 'admin')
    );

COMMIT;
