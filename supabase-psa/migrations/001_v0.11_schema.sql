-- V0.11 Full Schema Migration for Supabase Postgres

BEGIN;

-- ============================
-- Base tables (existing from SQLite)
-- ============================

CREATE TABLE organizations (
    id              BIGINT PRIMARY KEY,
    org_code        TEXT UNIQUE NOT NULL,
    org_name        TEXT NOT NULL,
    parent_id       BIGINT REFERENCES organizations(id),
    org_type        TEXT NOT NULL DEFAULT 'department',
    manager_user_id BIGINT,
    status          TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE projects (
    id              BIGINT PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    contract_amount NUMERIC(14,2) DEFAULT 0,
    received_amount NUMERIC(14,2) DEFAULT 0,
    receivable_amount NUMERIC(14,2) GENERATED ALWAYS AS (GREATEST(contract_amount - received_amount, 0)) STORED,
    owner_org_id    BIGINT REFERENCES organizations(id),
    project_owner_id BIGINT,
    status          TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE timesheets (
    id              BIGINT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    week_start_date DATE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    remark          TEXT DEFAULT '',
    review_comment  TEXT DEFAULT '',
    submitted_at    TIMESTAMPTZ,
    approved_by     BIGINT,
    approved_at     TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, week_start_date)
);

CREATE TABLE timesheet_entries (
    id              BIGINT PRIMARY KEY,
    timesheet_id    BIGINT NOT NULL REFERENCES timesheets(id),
    project_id      BIGINT NOT NULL REFERENCES projects(id),
    work_date       DATE NOT NULL,
    hours           NUMERIC(5,2) NOT NULL DEFAULT 0,
    description     TEXT DEFAULT ''
);

CREATE TABLE overtime_entries (
    id              BIGINT PRIMARY KEY,
    timesheet_id    BIGINT NOT NULL REFERENCES timesheets(id),
    work_date       DATE NOT NULL,
    overtime_hours  NUMERIC(5,1) DEFAULT 0,
    reason          TEXT DEFAULT '',
    status          TEXT DEFAULT 'pending',
    approved_by     BIGINT,
    approved_at     TIMESTAMPTZ,
    reject_comment  TEXT DEFAULT ''
);

CREATE TABLE workflow_templates (
    id              BIGINT PRIMARY KEY,
    workflow_key    TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    target_type     TEXT NOT NULL,
    status          TEXT DEFAULT 'active'
);

CREATE TABLE workflow_steps (
    id              BIGINT PRIMARY KEY,
    template_id     BIGINT NOT NULL REFERENCES workflow_templates(id),
    step_order      INT NOT NULL,
    step_key        TEXT NOT NULL,
    assignee_role   TEXT DEFAULT 'manager',
    assignee_strategy TEXT DEFAULT 'direct_manager',
    action_policy   TEXT DEFAULT 'approve_reject'
);

CREATE TABLE workflow_tasks (
    id              BIGSERIAL PRIMARY KEY,
    workflow_key    TEXT NOT NULL,
    target_type     TEXT NOT NULL,
    target_id       BIGINT NOT NULL,
    status          TEXT DEFAULT 'pending',
    assignee_role   TEXT,
    assignee_user_id BIGINT,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_by    BIGINT,
    completed_at    TIMESTAMPTZ,
    result_action   TEXT,
    comment         TEXT DEFAULT ''
);

CREATE TABLE approval_logs (
    id              BIGSERIAL PRIMARY KEY,
    target_type     TEXT NOT NULL DEFAULT 'timesheet',
    target_id       BIGINT NOT NULL,
    actor_id        BIGINT,
    action          TEXT NOT NULL,
    comment         TEXT DEFAULT '',
    from_status     TEXT,
    to_status       TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_labor_costs (
    id              BIGSERIAL PRIMARY KEY,
    project_id      BIGINT NOT NULL REFERENCES projects(id),
    week_start_date DATE NOT NULL,
    labor_days      NUMERIC(8,2) DEFAULT 0,
    labor_cost      NUMERIC(14,2) DEFAULT 0,
    calculated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================
-- New V0.11 tables
-- ============================

CREATE TABLE profiles (
    id              BIGSERIAL PRIMARY KEY,
    auth_user_id    UUID UNIQUE,
    login_name      TEXT UNIQUE NOT NULL,
    auth_email      TEXT UNIQUE,
    display_name    TEXT NOT NULL,
    is_system_account BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    must_change_password BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employees (
    id              BIGINT PRIMARY KEY,
    employee_no     TEXT UNIQUE NOT NULL,
    auth_user_id    UUID UNIQUE,
    name            TEXT NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employee_profiles_v2 (
    id              BIGSERIAL PRIMARY KEY,
    employee_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    org_id          BIGINT REFERENCES organizations(id),
    position_name   TEXT DEFAULT '',
    employment_status TEXT DEFAULT 'active',
    manager_user_id BIGINT,
    hire_date       DATE,
    row_locked      BOOLEAN DEFAULT FALSE,
    row_lock_reason TEXT DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id)
);

CREATE TABLE employee_contracts (
    id                  BIGSERIAL PRIMARY KEY,
    employee_id         BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    contract_type       TEXT DEFAULT 'labor',
    employment_type     TEXT DEFAULT 'labor',
    contract_start      DATE,
    contract_end        DATE,
    contract_duration_months INT DEFAULT 12,
    status              TEXT DEFAULT 'active',
    is_current          BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE employee_salary_profiles (
    id                      BIGSERIAL PRIMARY KEY,
    employee_id             BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    salary_mode             TEXT DEFAULT 'monthly_salary',
    monthly_salary          NUMERIC(12,2) DEFAULT 0,
    daily_wage              NUMERIC(12,2) DEFAULT 0,
    standard_monthly_workdays NUMERIC(5,2) DEFAULT 21.75,
    effective_from          DATE DEFAULT CURRENT_DATE,
    effective_to            DATE,
    is_current              BOOLEAN DEFAULT TRUE,
    is_complete             BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_roles (
    id          BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'employee',
    granted_by  BIGINT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, role)
);

CREATE TABLE migration_id_map (
    id          BIGSERIAL PRIMARY KEY,
    table_name  TEXT NOT NULL,
    old_id      BIGINT NOT NULL,
    new_id      BIGINT,
    new_uuid    UUID,
    migrated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(table_name, old_id)
);

CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    BIGINT,
    entity_type TEXT NOT NULL,
    entity_id   BIGINT,
    action      TEXT NOT NULL,
    before_json JSONB,
    after_json  JSONB,
    reason      TEXT DEFAULT '',
    ip_address  TEXT DEFAULT '',
    user_agent  TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================
-- HR Unified Read View
-- ============================

CREATE OR REPLACE VIEW hr_employee_current_view AS
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
-- Indexes
-- ============================

CREATE INDEX idx_workflow_tasks_assignee ON workflow_tasks(assignee_user_id, status);
CREATE INDEX idx_workflow_tasks_target ON workflow_tasks(target_type, target_id);
CREATE INDEX idx_timesheet_entries_ts ON timesheet_entries(timesheet_id);
CREATE INDEX idx_timesheet_user ON timesheets(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_employee_contracts_current ON employee_contracts(employee_id, is_current);
CREATE INDEX idx_employee_salary_current ON employee_salary_profiles(employee_id, is_current);

COMMIT;
