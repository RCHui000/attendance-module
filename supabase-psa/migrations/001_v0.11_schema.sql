-- V0.11 Supabase Migration: New table structure
-- Run: psql -U psa_admin -d psa -f 001_v0.11_schema.sql

BEGIN;

-- ============================
-- User identity & profiles
-- ============================

CREATE TABLE IF NOT EXISTS profiles (
    id              BIGSERIAL PRIMARY KEY,
    auth_user_id    UUID UNIQUE NOT NULL,       -- Supabase Auth user ID
    login_name      TEXT UNIQUE NOT NULL,       -- e.g. "admin", "jss"
    auth_email      TEXT UNIQUE,               -- e.g. "admin@psa.local"
    display_name    TEXT NOT NULL,              -- e.g. "惠若超"
    is_system_account BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- Employees (stable identity, no salary/contract)
-- ============================

CREATE TABLE IF NOT EXISTS employees (
    id              BIGSERIAL PRIMARY KEY,
    employee_no     TEXT UNIQUE NOT NULL,
    auth_user_id    UUID UNIQUE REFERENCES profiles(auth_user_id),
    name            TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- Employee profiles (org, position, manager — current status)
-- ============================

CREATE TABLE IF NOT EXISTS employee_profiles_v2 (
    id              BIGSERIAL PRIMARY KEY,
    employee_id     BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    org_id          BIGINT REFERENCES organizations(id),
    position_name   TEXT DEFAULT '',
    employment_status TEXT NOT NULL DEFAULT 'active',
    manager_user_id BIGINT REFERENCES employees(id),
    hire_date       DATE,
    row_locked      BOOLEAN NOT NULL DEFAULT FALSE,
    row_lock_reason TEXT DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(employee_id)
);

-- ============================
-- Employee contracts
-- ============================

CREATE TABLE IF NOT EXISTS employee_contracts (
    id                  BIGSERIAL PRIMARY KEY,
    employee_id         BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    contract_type       TEXT NOT NULL DEFAULT 'labor',
    employment_type     TEXT NOT NULL DEFAULT 'labor',
    contract_start      DATE,
    contract_end        DATE,
    contract_duration_months INT DEFAULT 12,
    status              TEXT NOT NULL DEFAULT 'active',
    is_current          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- Employee salary profiles
-- ============================

CREATE TABLE IF NOT EXISTS employee_salary_profiles (
    id                      BIGSERIAL PRIMARY KEY,
    employee_id             BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    salary_mode             TEXT NOT NULL DEFAULT 'monthly_salary',
    monthly_salary          NUMERIC(12,2) DEFAULT 0,
    daily_wage              NUMERIC(12,2) DEFAULT 0,
    standard_monthly_workdays NUMERIC(5,2) DEFAULT 21.75,
    effective_from          DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to            DATE,
    is_current              BOOLEAN NOT NULL DEFAULT TRUE,
    is_complete             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================
-- Migration ID map (old SQLite IDs → new Supabase UUIDs)
-- ============================

CREATE TABLE IF NOT EXISTS migration_id_map (
    id              BIGSERIAL PRIMARY KEY,
    table_name      TEXT NOT NULL,
    old_id          BIGINT NOT NULL,
    new_id          BIGINT,
    new_uuid        UUID,
    migrated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(table_name, old_id)
);

-- ============================
-- HR unified read view
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
    mgr.name                AS manager_name,
    ep.hire_date,
    ep.row_locked,
    ep.row_lock_reason,
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
LEFT JOIN employees mgr ON mgr.id = ep.manager_user_id
LEFT JOIN employee_contracts ec ON ec.employee_id = e.id AND ec.is_current = TRUE
LEFT JOIN employee_salary_profiles esp ON esp.employee_id = e.id AND esp.is_current = TRUE;

-- ============================
-- RBAC helper: user roles
-- ============================

CREATE TABLE IF NOT EXISTS user_roles (
    id          BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'employee',
    granted_by  BIGINT REFERENCES employees(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(employee_id, role)
);

-- ============================
-- Audit logs
-- ============================

CREATE TABLE IF NOT EXISTS audit_logs (
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
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

COMMIT;
