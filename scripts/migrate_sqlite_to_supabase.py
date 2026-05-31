#!/usr/bin/env python3
"""V0.11: SQLite → Supabase Postgres 数据迁移脚本

前置条件:
  1. V0.10 SQLite 已备份到 backups/v0.10/
  2. Supabase Postgres 已运行，migrations/001 已执行
  3. 设置环境变量: DATABASE_URL, SUPABASE_URL, SERVICE_ROLE_KEY

用法:
  python scripts/migrate_sqlite_to_supabase.py \
    --sqlite data/attendance_demo.sqlite3 \
    --pg-url postgresql://psa_admin:pass@localhost:5433/psa \
    --validate
"""

import sqlite3
import os
import sys
import json
import argparse
from datetime import datetime

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("请先安装 psycopg2: pip install psycopg2-binary")
    sys.exit(1)

MIGRATION_ORDER = [
    "organizations",
    "users",            # → profiles + employees
    "employee_profiles",# → employee_profiles_v2 + contracts + salary
    "projects",
    "timesheets",
    "timesheet_entries",
    "overtime_entries",
    "workflow_templates",
    "workflow_steps",
    "workflow_tasks",
    "approval_logs",
]

def connect_sqlite(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn

def connect_pg(url: str):
    conn = psycopg2.connect(url)
    conn.autocommit = False
    return conn

def migrate_organizations(sqlite_conn, pg_conn):
    """迁移组织架构"""
    rows = sqlite_conn.execute(
        "SELECT id, org_code, org_name, parent_id, org_type, manager_user_id, status FROM organizations"
    ).fetchall()

    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO organizations(id, org_code, org_name, parent_id, org_type, manager_user_id, status)
                   VALUES(%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT(id) DO NOTHING""",
                (r["id"], r["org_code"], r["org_name"], r["parent_id"], r["org_type"], r["manager_user_id"], r["status"]),
            )
            cur.execute(
                "INSERT INTO migration_id_map(table_name, old_id, new_id) VALUES('organizations', %s, %s) ON CONFLICT DO NOTHING",
                (r["id"], r["id"]),
            )
    pg_conn.commit()
    print(f"  ✓ organizations: {len(rows)} rows")

def migrate_users(sqlite_conn, pg_conn):
    """迁移用户: users → profiles + employees"""
    rows = sqlite_conn.execute(
        "SELECT id, name, role, department, is_active FROM users"
    ).fetchall()

    with pg_conn.cursor() as cur:
        for r in rows:
            login_name = r["name"]
            auth_email = f"{login_name}@psa.local"
            is_system = login_name == "admin"
            display_name = r["name"]

            # Profiles (will be linked to auth.users later)
            cur.execute(
                """INSERT INTO profiles(login_name, auth_email, display_name, is_system_account, is_active)
                   VALUES(%s, %s, %s, %s, %s)
                   ON CONFLICT(login_name) DO UPDATE SET display_name=EXCLUDED.display_name
                   RETURNING id""",
                (login_name, auth_email, display_name, is_system, bool(r["is_active"])),
            )

            # Employees
            employee_no = f"QS{r['id']:06d}"
            if r["id"] == 1:
                employee_no = "QS260416"

            cur.execute(
                """INSERT INTO employees(id, employee_no, name, is_active)
                   VALUES(%s, %s, %s, %s)
                   ON CONFLICT(id) DO NOTHING""",
                (r["id"], employee_no, r["name"], bool(r["is_active"])),
            )

            # User roles
            role = r["role"]
            if role not in ("employee", "manager", "admin"):
                role = "employee"
            cur.execute(
                "INSERT INTO user_roles(employee_id, role) VALUES(%s, %s) ON CONFLICT DO NOTHING",
                (r["id"], role),
            )

            cur.execute(
                "INSERT INTO migration_id_map(table_name, old_id, new_id) VALUES('users', %s, %s) ON CONFLICT DO NOTHING",
                (r["id"], r["id"]),
            )
    pg_conn.commit()
    print(f"  ✓ users: {len(rows)} rows → profiles + employees + user_roles")

def migrate_employee_profiles(sqlite_conn, pg_conn):
    """迁移 employee_profiles → profiles_v2 + contracts + salary"""
    rows = sqlite_conn.execute(
        """SELECT user_id, employee_no, org_id, position_name, employment_type,
                  contract_type, monthly_salary, daily_wage, standard_monthly_workdays,
                  hire_date, contract_start, contract_end, manager_user_id, status
           FROM employee_profiles"""
    ).fetchall()

    contract_count = 0
    salary_count = 0

    with pg_conn.cursor() as cur:
        for r in rows:
            eid = r["user_id"]

            # Employee profiles v2
            cur.execute(
                """INSERT INTO employee_profiles_v2(employee_id, org_id, position_name, employment_status,
                   manager_user_id, hire_date)
                   VALUES(%s, %s, %s, %s, %s, %s)
                   ON CONFLICT(employee_id) DO NOTHING""",
                (eid, r["org_id"], r["position_name"] or "",
                 r["status"] or "active", r["manager_user_id"], r["hire_date"]),
            )

            # Contracts
            if r["contract_type"]:
                cur.execute(
                    """INSERT INTO employee_contracts(employee_id, contract_type, employment_type,
                       contract_start, contract_end, is_current)
                       VALUES(%s, %s, %s, %s, %s, TRUE)""",
                    (eid, r["contract_type"], r["employment_type"] or r["contract_type"],
                     r["contract_start"], r["contract_end"]),
                )
                contract_count += 1

            # Salary profiles
            has_monthly = float(r["monthly_salary"] or 0) > 0
            has_daily = float(r["daily_wage"] or 0) > 0
            is_complete = has_monthly or has_daily

            if r["contract_type"] == "service":
                salary_mode = "daily_wage"
            else:
                salary_mode = "monthly_salary"

            cur.execute(
                """INSERT INTO employee_salary_profiles(employee_id, salary_mode, monthly_salary,
                   daily_wage, standard_monthly_workdays, is_current, is_complete)
                   VALUES(%s, %s, %s, %s, %s, TRUE, %s)""",
                (eid, salary_mode,
                 float(r["monthly_salary"] or 0), float(r["daily_wage"] or 0),
                 float(r["standard_monthly_workdays"] or 21.75), is_complete),
            )
            salary_count += 1

    pg_conn.commit()
    print(f"  ✓ employee_profiles: {len(rows)} rows → profiles_v2 + {contract_count} contracts + {salary_count} salary")

def migrate_projects(sqlite_conn, pg_conn):
    rows = sqlite_conn.execute(
        "SELECT id, code, name, contract_amount, received_amount, owner_org_id, project_owner_id, status FROM projects"
    ).fetchall()
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO projects(id, code, name, contract_amount, received_amount, owner_org_id, project_owner_id, status)
                   VALUES(%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT(id) DO NOTHING""",
                (r["id"], r["code"], r["name"], r["contract_amount"] or 0, r["received_amount"] or 0,
                 r["owner_org_id"], r["project_owner_id"], r["status"] or "active"),
            )
    pg_conn.commit()
    print(f"  ✓ projects: {len(rows)} rows")

def migrate_timesheets(sqlite_conn, pg_conn):
    rows = sqlite_conn.execute(
        "SELECT id, user_id, week_start_date, status, remark, submitted_at, approved_by, approved_at, review_comment, updated_at FROM timesheets"
    ).fetchall()
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO timesheets(id, user_id, week_start_date, status, remark, submitted_at,
                   approved_by, approved_at, review_comment, updated_at)
                   VALUES(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT(id) DO NOTHING""",
                (r["id"], r["user_id"], r["week_start_date"], r["status"], r["remark"],
                 r["submitted_at"], r["approved_by"], r["approved_at"], r["review_comment"], r["updated_at"]),
            )
    pg_conn.commit()
    print(f"  ✓ timesheets: {len(rows)} rows")

def migrate_entries(sqlite_conn, pg_conn):
    rows = sqlite_conn.execute(
        "SELECT id, timesheet_id, project_id, work_date, hours, description FROM timesheet_entries"
    ).fetchall()
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute(
                "INSERT INTO timesheet_entries(id, timesheet_id, project_id, work_date, hours, description) VALUES(%s, %s, %s, %s, %s, %s) ON CONFLICT(id) DO NOTHING",
                (r["id"], r["timesheet_id"], r["project_id"], r["work_date"], r["hours"], r["description"]),
            )
    pg_conn.commit()
    print(f"  ✓ timesheet_entries: {len(rows)} rows")

def migrate_overtime(sqlite_conn, pg_conn):
    rows = sqlite_conn.execute(
        "SELECT id, timesheet_id, work_date, overtime_hours, reason, status, approved_by, approved_at, reject_comment FROM overtime_entries"
    ).fetchall()
    with pg_conn.cursor() as cur:
        for r in rows:
            cur.execute(
                "INSERT INTO overtime_entries(id, timesheet_id, work_date, overtime_hours, reason, status, approved_by, approved_at, reject_comment) VALUES(%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT(id) DO NOTHING",
                (r["id"], r["timesheet_id"], r["work_date"], r["overtime_hours"], r["reason"],
                 r["status"], r["approved_by"], r["approved_at"], r["reject_comment"]),
            )
    pg_conn.commit()
    print(f"  ✓ overtime_entries: {len(rows)} rows")

def migrate_workflow(sqlite_conn, pg_conn):
    for table in ["workflow_templates", "workflow_steps", "workflow_tasks", "approval_logs"]:
        try:
            rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()
            if not rows:
                print(f"  - {table}: 0 rows (skipped)")
                continue
            cols = rows[0].keys()
            col_names = ", ".join(cols)
            placeholders = ", ".join(["%s"] * len(cols))
            with pg_conn.cursor() as cur:
                for r in rows:
                    vals = [r[c] for c in cols]
                    cur.execute(
                        f"INSERT INTO {table}({col_names}) VALUES({placeholders}) ON CONFLICT(id) DO NOTHING",
                        vals,
                    )
            pg_conn.commit()
            print(f"  ✓ {table}: {len(rows)} rows")
        except Exception as e:
            print(f"  ⚠ {table}: {e}")

def validate(sqlite_conn, pg_conn):
    """迁移后数据校验"""
    print("\n=== 数据校验 ===")

    checks = [
        ("organizations", "SELECT COUNT(*) FROM organizations"),
        ("profiles", "SELECT COUNT(*) FROM profiles"),
        ("employees", "SELECT COUNT(*) FROM employees"),
        ("projects", "SELECT COUNT(*) FROM projects"),
        ("timesheets", "SELECT COUNT(*) FROM timesheets"),
        ("timesheet_entries", "SELECT COUNT(*) FROM timesheet_entries"),
        ("overtime_entries", "SELECT COUNT(*) FROM overtime_entries"),
        ("workflow_tasks", "SELECT COUNT(*) FROM workflow_tasks"),
    ]

    for name, query in checks:
        pg_count = pg_conn.cursor().execute(query).fetchone()[0]
        print(f"  {name}: {pg_count} rows")

    # Check salary migration completeness
    with pg_conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM employee_salary_profiles WHERE is_current = TRUE")
        salary_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM employee_contracts WHERE is_current = TRUE")
        contract_count = cur.fetchone()[0]
    print(f"  employee_salary_profiles (current): {salary_count}")
    print(f"  employee_contracts (current): {contract_count}")

def main():
    parser = argparse.ArgumentParser(description="V0.11 SQLite → Supabase migration")
    parser.add_argument("--sqlite", required=True)
    parser.add_argument("--pg-url", required=True)
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()

    sqlite_conn = connect_sqlite(args.sqlite)
    pg_conn = connect_pg(args.pg_url)

    # Reset sequence values after inserting with explicit IDs
    print("=== 开始数据迁移 ===")

    migrate_organizations(sqlite_conn, pg_conn)
    migrate_users(sqlite_conn, pg_conn)
    migrate_employee_profiles(sqlite_conn, pg_conn)
    migrate_projects(sqlite_conn, pg_conn)
    migrate_timesheets(sqlite_conn, pg_conn)
    migrate_entries(sqlite_conn, pg_conn)
    migrate_overtime(sqlite_conn, pg_conn)
    migrate_workflow(sqlite_conn, pg_conn)

    # Reset sequences
    with pg_conn.cursor() as cur:
        cur.execute("SELECT setval('profiles_id_seq', COALESCE((SELECT MAX(id) FROM profiles), 1))")
        cur.execute("SELECT setval('employees_id_seq', COALESCE((SELECT MAX(id) FROM employees), 1))")
    pg_conn.commit()

    if args.validate:
        validate(sqlite_conn, pg_conn)

    sqlite_conn.close()
    pg_conn.close()
    print("\n=== 迁移完成 ===")

if __name__ == "__main__":
    main()
