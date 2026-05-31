from __future__ import annotations

import json
import hashlib
import hmac
import os
import secrets
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urlparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("ATTENDANCE_DB_PATH", ROOT / "attendance_demo.sqlite3"))
STATIC_DIR = ROOT / "static"

WORKFLOWS = {
    "timesheet": {
        "target_type": "timesheet",
        "table": "timesheets",
        "review_role": "department_head",
        "transitions": {
            "submit": {
                "from": {"draft", "rejected"},
                "to": "submitted",
                "roles": {"employee"},
                "owner_only": True,
                "create_task": True,
                "validators": ("daily_total_not_exceed_100",),
            },
            "approve": {
                "from": {"submitted"},
                "to": "approved",
                "roles": {"employee", "manager", "admin"},
                "complete_task": True,
            },
            "reject": {
                "from": {"submitted"},
                "to": "rejected",
                "roles": {"employee", "manager", "admin"},
                "complete_task": True,
            },
            "reopen": {
                "from": {"approved", "rejected"},
                "to": "draft",
                "roles": {"manager", "admin"},
            },
        },
    },
    "overtime": {
        "target_type": "overtime",
        "table": "overtime_entries",
        "review_role": "manager",
        "transitions": {
            "approve": {"from": {"pending"}, "to": "approved", "roles": {"manager", "admin"}, "complete_task": True},
            "reject": {"from": {"pending"}, "to": "rejected", "roles": {"manager", "admin"}, "complete_task": True},
        },
    },
}

SUPERUSER_NAMES = {"admin", "鞠松松"}
SYSTEM_ACCOUNT_LOGINS = {"admin"}


def dict_rows(cursor: sqlite3.Cursor) -> list[dict]:
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def monday_of_week(day: date | None = None) -> date:
    day = day or date.today()
    return day - timedelta(days=day.weekday())


def normalize_week_start(value: str | None = None) -> str:
    try:
        day = date.fromisoformat(value) if value else date.today()
    except ValueError:
        day = date.today()
    return monday_of_week(day).isoformat()


def add_months(day: date, months: int) -> date:
    month = day.month - 1 + months
    year = day.year + month // 12
    month = month % 12 + 1
    month_end = date(year, month, 28)
    while True:
        try:
            month_end = month_end.replace(day=month_end.day + 1)
        except ValueError:
            break
    return date(year, month, min(day.day, month_end.day))


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS organizations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              org_code TEXT UNIQUE NOT NULL,
              org_name TEXT NOT NULL,
              parent_id INTEGER,
              org_type TEXT NOT NULL DEFAULT 'department',
              manager_user_id INTEGER,
              status TEXT NOT NULL DEFAULT 'active',
              FOREIGN KEY(parent_id) REFERENCES organizations(id),
              FOREIGN KEY(manager_user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'employee',
              department TEXT NOT NULL DEFAULT '',
              is_active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS employee_profiles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER UNIQUE NOT NULL,
              employee_no TEXT UNIQUE NOT NULL,
              org_id INTEGER,
              job_level TEXT NOT NULL DEFAULT 'employee',
              position_name TEXT DEFAULT '',
              employment_type TEXT NOT NULL DEFAULT 'labor',
              contract_type TEXT NOT NULL DEFAULT 'labor',
              monthly_salary REAL,
              daily_wage REAL,
              standard_monthly_workdays REAL NOT NULL DEFAULT 26,
              hire_date TEXT,
              status TEXT NOT NULL DEFAULT 'active',
              manager_user_id INTEGER,
              FOREIGN KEY(user_id) REFERENCES users(id),
              FOREIGN KEY(org_id) REFERENCES organizations(id),
              FOREIGN KEY(manager_user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS auth_accounts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER UNIQUE NOT NULL,
              login TEXT UNIQUE NOT NULL,
              password_hash TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS auth_sessions (
              token TEXT PRIMARY KEY,
              user_id INTEGER NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              expires_at TEXT NOT NULL,
              FOREIGN KEY(user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS projects (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              code TEXT UNIQUE NOT NULL,
              name TEXT NOT NULL,
              contract_amount REAL NOT NULL DEFAULT 0,
              received_amount REAL NOT NULL DEFAULT 0,
              owner_org_id INTEGER,
              status TEXT NOT NULL DEFAULT 'active'
            );

            CREATE TABLE IF NOT EXISTS contracts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER NOT NULL,
              contract_no TEXT DEFAULT '',
              contract_name TEXT NOT NULL DEFAULT '',
              contract_amount REAL NOT NULL DEFAULT 0,
              received_amount REAL NOT NULL DEFAULT 0,
              status TEXT NOT NULL DEFAULT 'active',
              signed_at TEXT,
              FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS timesheets (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              week_start_date TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'draft',
              remark TEXT DEFAULT '',
              review_comment TEXT DEFAULT '',
              submitted_at TEXT,
              approved_by INTEGER,
              approved_at TEXT,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(user_id, week_start_date),
              FOREIGN KEY(user_id) REFERENCES users(id),
              FOREIGN KEY(approved_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS timesheet_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timesheet_id INTEGER NOT NULL,
              project_id INTEGER NOT NULL,
              work_date TEXT NOT NULL,
              hours REAL NOT NULL DEFAULT 0 CHECK(hours >= 0 AND hours <= 1),
              description TEXT DEFAULT '',
              FOREIGN KEY(timesheet_id) REFERENCES timesheets(id) ON DELETE CASCADE,
              FOREIGN KEY(project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS project_labor_costs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER NOT NULL,
              week_start_date TEXT NOT NULL,
              labor_days REAL NOT NULL DEFAULT 0,
              labor_cost REAL NOT NULL DEFAULT 0,
              calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(project_id, week_start_date),
              FOREIGN KEY(project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS overtime_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timesheet_id INTEGER NOT NULL,
              work_date TEXT NOT NULL,
              overtime_hours REAL NOT NULL DEFAULT 0 CHECK(overtime_hours >= 0),
              reason TEXT DEFAULT '',
              UNIQUE(timesheet_id, work_date),
              FOREIGN KEY(timesheet_id) REFERENCES timesheets(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS approval_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timesheet_id INTEGER,
              target_type TEXT NOT NULL DEFAULT 'timesheet',
              target_id INTEGER,
              from_status TEXT,
              to_status TEXT,
              actor_id INTEGER NOT NULL,
              action TEXT NOT NULL,
              comment TEXT DEFAULT '',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY(timesheet_id) REFERENCES timesheets(id) ON DELETE CASCADE,
              FOREIGN KEY(actor_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS workflow_tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              workflow_key TEXT NOT NULL,
              target_type TEXT NOT NULL,
              target_id INTEGER NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending',
              assignee_role TEXT NOT NULL DEFAULT 'manager',
              assignee_user_id INTEGER,
              created_by INTEGER,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              completed_by INTEGER,
              completed_at TEXT,
              result_action TEXT,
              comment TEXT DEFAULT '',
              FOREIGN KEY(assignee_user_id) REFERENCES users(id),
              FOREIGN KEY(created_by) REFERENCES users(id),
              FOREIGN KEY(completed_by) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS workflow_templates (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              workflow_key TEXT UNIQUE NOT NULL,
              name TEXT NOT NULL,
              target_type TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'active'
            );

            CREATE TABLE IF NOT EXISTS workflow_steps (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              template_id INTEGER NOT NULL,
              step_order INTEGER NOT NULL,
              step_key TEXT NOT NULL,
              assignee_role TEXT NOT NULL DEFAULT 'manager',
              assignee_strategy TEXT NOT NULL DEFAULT 'direct_manager',
              action_policy TEXT NOT NULL DEFAULT 'approve_reject',
              FOREIGN KEY(template_id) REFERENCES workflow_templates(id) ON DELETE CASCADE
            );
            """
        )

        migrate_schema(conn)
        if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
            conn.executemany(
                "INSERT INTO users(name, role, department) VALUES(?, ?, ?)",
                [
                    ("惠若超", "employee", "造价二部"),
                    ("admin", "admin", "系统"),
                    ("鞠松松", "admin", "造价二部"),
                ],
            )

        if conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 0:
            conn.executemany(
                "INSERT INTO projects(code, name, owner_org_id) VALUES(?, ?, 1)",
                [
                    ("P001", "顶点公园"),
                    ("P002", "海昌海洋公园"),
                    ("P003", "城市运动中心"),
                    ("P004", "北师大"),
                    ("P005", "北京腾讯学知园"),
                    ("P006", "首都医科大学"),
                    ("P007", "爱奇艺"),
                    ("P008", "泡泡玛特"),
                    ("P009", "大运河水景演艺项目"),
                    ("P010", "北运河西岸改造"),
                ],
            )

        seed_org_employee_auth(conn)

        normalize_demo_ratios(conn)
        reconcile_workflow_tasks(conn)
        week_start = monday_of_week().isoformat()
        ensure_timesheet(conn, 1, week_start)
        seed_demo_entries(conn, 1, week_start)


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def migrate_schema(conn: sqlite3.Connection) -> None:
    ensure_column(conn, "projects", "contract_amount", "REAL NOT NULL DEFAULT 0")
    ensure_column(conn, "projects", "received_amount", "REAL NOT NULL DEFAULT 0")
    ensure_column(conn, "projects", "owner_org_id", "INTEGER")
    ensure_column(conn, "projects", "project_owner_id", "INTEGER")
    ensure_column(conn, "employee_profiles", "contract_start", "TEXT")
    ensure_column(conn, "employee_profiles", "contract_end", "TEXT")
    ensure_column(conn, "employee_profiles", "job_level", "TEXT NOT NULL DEFAULT 'employee'")
    ensure_column(conn, "overtime_entries", "status", "TEXT NOT NULL DEFAULT 'pending'")
    ensure_column(conn, "overtime_entries", "approved_by", "INTEGER")
    ensure_column(conn, "overtime_entries", "approved_at", "TEXT")
    ensure_column(conn, "overtime_entries", "reject_comment", "TEXT DEFAULT ''")
    ensure_column(conn, "approval_logs", "target_type", "TEXT NOT NULL DEFAULT 'timesheet'")
    ensure_column(conn, "approval_logs", "target_id", "INTEGER")
    ensure_column(conn, "approval_logs", "from_status", "TEXT")
    ensure_column(conn, "approval_logs", "to_status", "TEXT")
    ensure_column(conn, "workflow_tasks", "assignee_user_id", "INTEGER")
    conn.execute("UPDATE approval_logs SET target_id = timesheet_id WHERE target_id IS NULL")
    seed_workflow_templates(conn)
    sync_employee_account_logins(conn)


def seed_workflow_templates(conn: sqlite3.Connection) -> None:
    templates = [
        ("timesheet", "周表审批", "timesheet"),
        ("overtime", "加班 OT 审批", "overtime"),
    ]
    for workflow_key, name, target_type in templates:
        cur = conn.execute(
            """
            INSERT INTO workflow_templates(workflow_key, name, target_type)
            SELECT ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM workflow_templates WHERE workflow_key = ?)
            """,
            (workflow_key, name, target_type, workflow_key),
        )
        template = conn.execute("SELECT id FROM workflow_templates WHERE workflow_key = ?", (workflow_key,)).fetchone()
        if not template:
            continue
        conn.execute(
            """
            INSERT INTO workflow_steps(template_id, step_order, step_key, assignee_role, assignee_strategy, action_policy)
            SELECT ?, 1, 'manager_review', 'manager', 'direct_manager', 'approve_reject'
            WHERE NOT EXISTS (SELECT 1 FROM workflow_steps WHERE template_id = ? AND step_key = 'manager_review')
            """,
            (template["id"], template["id"]),
        )


def sync_employee_account_logins(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        """
        SELECT u.id AS user_id, u.name, a.login
        FROM users u
        JOIN employee_profiles p ON p.user_id = u.id
        JOIN auth_accounts a ON a.user_id = u.id
        WHERE u.is_active = 1
          AND a.login NOT IN ('admin')
          AND u.name NOT IN ('admin')
        """
    ).fetchall()
    for row in rows:
        if row["login"] == row["name"]:
            continue
        duplicate = conn.execute(
            "SELECT user_id FROM auth_accounts WHERE login = ? AND user_id != ?",
            (row["name"], row["user_id"]),
        ).fetchone()
        if duplicate:
            continue
        conn.execute("UPDATE auth_accounts SET login = ? WHERE user_id = ?", (row["name"], row["user_id"]))


def ensure_timesheet(conn: sqlite3.Connection, user_id: int, week_start: str) -> int:
    row = conn.execute(
        "SELECT id FROM timesheets WHERE user_id = ? AND week_start_date = ?",
        (user_id, week_start),
    ).fetchone()
    if row:
        return int(row["id"])
    cur = conn.execute(
        "INSERT INTO timesheets(user_id, week_start_date) VALUES(?, ?)",
        (user_id, week_start),
    )
    return int(cur.lastrowid)


def seed_demo_entries(conn: sqlite3.Connection, user_id: int, week_start: str) -> None:
    timesheet_id = ensure_timesheet(conn, user_id, week_start)
    if conn.execute(
        "SELECT COUNT(*) FROM timesheet_entries WHERE timesheet_id = ?",
        (timesheet_id,),
    ).fetchone()[0]:
        return

    start = date.fromisoformat(week_start)
    project_hours = {
        1: [0.2, 0.2, 0.3, 0.2, 0.2, 0.4, 0.4],
        2: [0.5, 0.4, 0.4, 0.5, 0.4, 0.3, 0.3],
        3: [0.3, 0.4, 0.3, 0.3, 0.4, 0.3, 0.3],
    }
    for project_id, hours_by_day in project_hours.items():
        for offset, hours in enumerate(hours_by_day):
            if hours:
                conn.execute(
                    """
                    INSERT INTO timesheet_entries(timesheet_id, project_id, work_date, hours, description)
                    VALUES(?, ?, ?, ?, ?)
                    """,
                    (
                        timesheet_id,
                        project_id,
                        (start + timedelta(days=offset)).isoformat(),
                        hours,
                        "方案深化 / 项目协调",
                    ),
                )


def password_hash(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$", 2)
    except ValueError:
        return False
    return hmac.compare_digest(password_hash(password, salt), stored)


def seed_org_employee_auth(conn: sqlite3.Connection) -> None:
    if conn.execute("SELECT COUNT(*) FROM organizations").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO organizations(org_code, org_name, parent_id, org_type, manager_user_id)
            VALUES(?, ?, ?, ?, ?)
            """,
            [
                ("COMP", "造价二部", None, "department", 3),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM employee_profiles").fetchone()[0] == 0:
        conn.executemany(
            """
            INSERT INTO employee_profiles(
              user_id, employee_no, org_id, position_name, employment_type,
              contract_type, monthly_salary, daily_wage, hire_date, manager_user_id
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (1, "QS260416", 1, "造价员", "labor", "labor", 18000, None, "2026-04-16", 3),
                (3, "001", 1, "项目负责人", "labor", "labor", 50000, None, "2026-01-01", None),
            ],
        )

    if conn.execute("SELECT COUNT(*) FROM auth_accounts").fetchone()[0] == 0:
        conn.executemany(
            "INSERT INTO auth_accounts(user_id, login, password_hash) VALUES(?, ?, ?)",
            [
                (1, "zhangchen", password_hash("123456")),
                (2, "admin", password_hash("123456")),
                (3, "jss", password_hash("123456")),
            ],
        )


def repair_demo_labels(conn: sqlite3.Connection) -> None:
    conn.execute("UPDATE users SET name = 'admin', role = 'admin', department = '系统' WHERE id = 2 AND name <> 'admin'")
    conn.execute("UPDATE users SET name = '鞠松松', role = 'admin', department = '造价二部' WHERE name = '鞠松松'")
    projects = [
        ("顶点公园", 1),
        ("海昌海洋公园", 2),
        ("城市运动中心", 3),
        ("北师大", 4),
        ("北京腾讯学知园", 5),
        ("首都医科大学", 6),
        ("爱奇艺", 7),
        ("泡泡玛特", 8),
        ("大运河水景演艺项目", 9),
        ("北运河西岸改造", 10),
    ]
    conn.executemany("UPDATE projects SET name = ? WHERE id = ?", projects)
    orgs = [
        ("示例公司", 1),
        ("设计一部", 2),
        ("工程管理部", 3),
        ("综合管理部", 4),
    ]
    conn.executemany("UPDATE organizations SET org_name = ? WHERE id = ?", orgs)
    profiles = [
        ("方案设计师", 1),
        ("现场协调", 2),
        ("部门主管", 3),
        ("人事管理员", 4),
    ]
    conn.executemany("UPDATE employee_profiles SET position_name = ? WHERE user_id = ?", profiles)
    conn.execute(
        "UPDATE timesheet_entries SET description = ? WHERE description <> ''",
        ("方案深化 / 项目协调",),
    )


def normalize_demo_ratios(conn: sqlite3.Connection) -> None:
    max_hours = conn.execute("SELECT COALESCE(MAX(hours), 0) FROM timesheet_entries").fetchone()[0]
    if max_hours and max_hours > 1:
        conn.execute(
            """
            UPDATE timesheet_entries
            SET hours = ROUND(hours / 8.0, 3)
            WHERE hours > 1
            """
        )


def reconcile_workflow_tasks(conn: sqlite3.Connection) -> None:
    for row in conn.execute("SELECT id, user_id FROM timesheets WHERE status = 'submitted'"):
        create_workflow_task(conn, "timesheet", "timesheet", row["id"], row["user_id"], WORKFLOWS["timesheet"]["review_role"])
    for row in conn.execute(
        """
        SELECT o.id, t.user_id
        FROM overtime_entries o
        JOIN timesheets t ON t.id = o.timesheet_id
        WHERE o.status = 'pending'
          AND o.overtime_hours > 0
        """
    ):
        create_workflow_task(conn, "overtime", "overtime", row["id"], row["user_id"], WORKFLOWS["overtime"]["review_role"])
    for row in conn.execute(
        """
        SELECT id, target_type, target_id, assignee_role
        FROM workflow_tasks
        WHERE status = 'pending'
          AND assignee_user_id IS NULL
        """
    ):
        conn.execute(
            "UPDATE workflow_tasks SET assignee_user_id = ? WHERE id = ?",
            (resolve_workflow_assignee(conn, row["target_type"], row["target_id"], row["assignee_role"]), row["id"]),
        )
    overflow_days = conn.execute(
        """
        SELECT timesheet_id, work_date, SUM(hours) AS day_total
        FROM timesheet_entries
        GROUP BY timesheet_id, work_date
        HAVING day_total > 1.0001
        """
    ).fetchall()
    for row in overflow_days:
        conn.execute(
            """
            UPDATE timesheet_entries
            SET hours = ROUND(hours / ?, 3)
            WHERE timesheet_id = ? AND work_date = ?
            """,
            (row["day_total"], row["timesheet_id"], row["work_date"]),
        )


def validate_day_totals(conn: sqlite3.Connection, timesheet_id: int) -> str | None:
    row = conn.execute(
        """
        SELECT work_date, ROUND(SUM(hours), 4) AS day_total
        FROM timesheet_entries
        WHERE timesheet_id = ?
        GROUP BY work_date
        HAVING day_total > 1.0001
        ORDER BY work_date
        LIMIT 1
        """,
        (timesheet_id,),
    ).fetchone()
    if row:
        return f"{row['work_date']} 合计 {row['day_total']} 工日，超过 1 工日"
    return None


def get_timesheet(conn: sqlite3.Connection, user_id: int, week_start: str) -> dict:
    timesheet_id = ensure_timesheet(conn, user_id, week_start)
    sheet = conn.execute(
        """
        SELECT t.*, u.name AS user_name, u.department
        FROM timesheets t
        JOIN users u ON u.id = t.user_id
        WHERE t.id = ?
        """,
        (timesheet_id,),
    ).fetchone()
    entries = dict_rows(
        conn.execute(
            """
            SELECT e.*, p.code AS project_code, p.name AS project_name
            FROM timesheet_entries e
            JOIN projects p ON p.id = e.project_id
            WHERE e.timesheet_id = ?
            ORDER BY p.code, e.work_date
            """,
            (timesheet_id,),
        )
    )
    overtime = dict_rows(
        conn.execute(
            """
            SELECT id, work_date, overtime_hours, reason, status, reject_comment,
                   approved_by, approved_at
            FROM overtime_entries
            WHERE timesheet_id = ?
            ORDER BY work_date
            """,
            (timesheet_id,),
        )
    )
    result = dict(sheet)
    result["entries"] = entries
    result["overtime"] = overtime
    result["days"] = [
        (date.fromisoformat(week_start) + timedelta(days=i)).isoformat()
        for i in range(7)
    ]
    return result


def get_timesheet_by_id(conn: sqlite3.Connection, timesheet_id: int) -> dict | None:
    sheet = conn.execute(
        """
        SELECT t.*, u.name AS user_name, u.department
        FROM timesheets t
        JOIN users u ON u.id = t.user_id
        WHERE t.id = ?
        """,
        (timesheet_id,),
    ).fetchone()
    if not sheet:
        return None
    entries = dict_rows(
        conn.execute(
            """
            SELECT e.*, p.code AS project_code, p.name AS project_name
            FROM timesheet_entries e
            JOIN projects p ON p.id = e.project_id
            WHERE e.timesheet_id = ?
            ORDER BY p.code, e.work_date
            """,
            (timesheet_id,),
        )
    )
    overtime = dict_rows(
        conn.execute(
            """
            SELECT id, work_date, overtime_hours, reason, status, reject_comment,
                   approved_by, approved_at
            FROM overtime_entries
            WHERE timesheet_id = ?
            ORDER BY work_date
            """,
            (timesheet_id,),
        )
    )
    result = dict(sheet)
    result["entries"] = entries
    result["overtime"] = overtime
    result["days"] = [
        (date.fromisoformat(result["week_start_date"]) + timedelta(days=i)).isoformat()
        for i in range(7)
    ]
    return result


def json_response(handler: SimpleHTTPRequestHandler, payload: object, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def cookie_user(handler: SimpleHTTPRequestHandler, conn: sqlite3.Connection) -> sqlite3.Row | None:
    cookie = SimpleCookie(handler.headers.get("Cookie", ""))
    morsel = cookie.get("attendance_sid")
    if not morsel:
        return None
    row = conn.execute(
        """
        SELECT u.*
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ?
        """,
        (morsel.value, datetime.now().isoformat(timespec="seconds")),
    ).fetchone()
    return row


def set_session_cookie(handler: SimpleHTTPRequestHandler, token: str) -> None:
    handler.send_header("Set-Cookie", f"attendance_sid={token}; Path=/; HttpOnly; SameSite=Lax")


def clear_session_cookie(handler: SimpleHTTPRequestHandler) -> None:
    handler.send_header("Set-Cookie", "attendance_sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")


def current_user_payload(user: sqlite3.Row | None) -> dict | None:
    return dict(user) if user else None


def require_user(handler: SimpleHTTPRequestHandler, user: sqlite3.Row | None) -> bool:
    if user:
        return True
    json_response(handler, {"ok": False, "message": "请先登录。"}, 401)
    return False


def is_admin(user: sqlite3.Row | None) -> bool:
    return bool(user and (user["role"] == "admin" or user["name"] in SUPERUSER_NAMES or user["id"] == 18))


def can_review(user: sqlite3.Row | None) -> bool:
    return bool(user and (user["role"] in ("manager", "admin") or user["name"] in SUPERUSER_NAMES or user["id"] == 18))


def reviewer_filter(user: sqlite3.Row | dict | None) -> tuple[bool, int | None]:
    if not user:
        return False, None
    user_id = int(user["id"])
    return is_admin(user), user_id


def change_password(conn: sqlite3.Connection, payload: dict) -> dict:
    login = payload.get("login", "").strip()
    old_password = payload.get("oldPassword", "")
    new_password = payload.get("newPassword", "")
    if not login or not old_password or not new_password:
        return {"ok": False, "message": "请填写账号、旧密码和新密码。"}
    if len(new_password) < 6:
        return {"ok": False, "message": "新密码至少 6 位。"}
    account = conn.execute(
        """
        SELECT a.*, u.is_active
        FROM auth_accounts a
        JOIN users u ON u.id = a.user_id
        WHERE a.login = ?
        """,
        (login,),
    ).fetchone()
    if not account or not account["is_active"] or not verify_password(old_password, account["password_hash"]):
        return {"ok": False, "message": "账号或旧密码不正确。"}
    conn.execute(
        "UPDATE auth_accounts SET password_hash = ? WHERE id = ?",
        (password_hash(new_password), account["id"]),
    )
    conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (account["user_id"],))
    return {"ok": True}


def create_workflow_task(
    conn: sqlite3.Connection,
    workflow_key: str,
    target_type: str,
    target_id: int,
    actor_id: int,
    assignee_role: str,
    step_order: int = 1,
) -> int | None:
    """Create a pending workflow task. Returns the assignee user_id or None."""
    assignee_user_id = resolve_workflow_assignee(conn, target_type, target_id, assignee_role)
    if not assignee_user_id:
        return None
    exists = conn.execute(
        """
        SELECT id FROM workflow_tasks
        WHERE workflow_key = ?
          AND target_type = ?
          AND target_id = ?
          AND assignee_role = ?
          AND status = 'pending'
        """,
        (workflow_key, target_type, target_id, assignee_role),
    ).fetchone()
    if exists:
        return assignee_user_id
    conn.execute(
        """
        INSERT INTO workflow_tasks(
          workflow_key, target_type, target_id, status, assignee_role, assignee_user_id, created_by
        )
        VALUES(?, ?, ?, 'pending', ?, ?, ?)
        """,
        (workflow_key, target_type, target_id, assignee_role, assignee_user_id, actor_id),
    )
    return assignee_user_id


def create_timesheet_approval_tasks(
    conn: sqlite3.Connection,
    timesheet_id: int,
    actor_id: int,
) -> None:
    """Create approval tasks for a submitted timesheet.

    For each project in the timesheet, find the project_owner and department_head.
    If they are the same person, create only 1 task (department_head).
    If different, create 2 sequential tasks (project_owner → department_head).
    """
    # Get all projects involved with their project_owner and department_head
    projects = conn.execute(
        """
        SELECT DISTINCT e.project_id, p.name AS project_name,
               -- Project owner: use project_owner_id directly, fallback to org manager
               COALESCE(
                   p.project_owner_id,
                   o.manager_user_id
               ) AS project_owner_id,
               COALESCE(pe.manager_user_id, dept.manager_user_id) AS dept_head_id
        FROM timesheet_entries e
        JOIN projects p ON p.id = e.project_id
        LEFT JOIN organizations o ON o.id = p.owner_org_id
        LEFT JOIN timesheets t ON t.id = e.timesheet_id
        LEFT JOIN users u ON u.id = t.user_id
        LEFT JOIN employee_profiles pe ON pe.user_id = u.id
        LEFT JOIN organizations dept ON dept.id = pe.org_id
        WHERE e.timesheet_id = ?
        """,
        (timesheet_id,),
    ).fetchall()

    seen_tasks = set()  # (role, assignee_id) pairs to deduplicate

    for proj in projects:
        # Resolve project owner (direct field on project, with org fallback)
        po_id = None
        if proj["project_owner_id"]:
            mgr = conn.execute(
                "SELECT id FROM users WHERE id = ? AND is_active = 1",
                (proj["project_owner_id"],),
            ).fetchone()
            if mgr:
                po_id = int(mgr["id"])

        # Resolve department head
        dh_id = None
        if proj["dept_head_id"]:
            dh = conn.execute(
                "SELECT id FROM users WHERE id = ? AND is_active = 1",
                (proj["dept_head_id"],),
            ).fetchone()
            if dh:
                dh_id = int(dh["id"])

        # Fallback to admin
        fallback = _fallback_admin(conn)
        if not po_id:
            po_id = fallback
        if not dh_id:
            dh_id = fallback

        # Deduplicate: same person for both roles → create only 1 task
        if po_id == dh_id:
            key = ("department_head", dh_id)
            if key not in seen_tasks and dh_id:
                seen_tasks.add(key)
                conn.execute(
                    """INSERT INTO workflow_tasks(
                        workflow_key, target_type, target_id, status,
                        assignee_role, assignee_user_id, created_by
                    ) VALUES('timesheet', 'timesheet', ?, 'pending', 'department_head', ?, ?)""",
                    (timesheet_id, dh_id, actor_id),
                )
        else:
            # Create project_owner task
            key_po = ("project_owner", po_id)
            if key_po not in seen_tasks and po_id:
                seen_tasks.add(key_po)
                conn.execute(
                    """INSERT INTO workflow_tasks(
                        workflow_key, target_type, target_id, status,
                        assignee_role, assignee_user_id, created_by
                    ) VALUES('timesheet', 'timesheet', ?, 'pending', 'project_owner', ?, ?)""",
                    (timesheet_id, po_id, actor_id),
                )
            # Create department_head task
            key_dh = ("department_head", dh_id)
            if key_dh not in seen_tasks and dh_id:
                seen_tasks.add(key_dh)
                conn.execute(
                    """INSERT INTO workflow_tasks(
                        workflow_key, target_type, target_id, status,
                        assignee_role, assignee_user_id, created_by
                    ) VALUES('timesheet', 'timesheet', ?, 'pending', 'department_head', ?, ?)""",
                    (timesheet_id, dh_id, actor_id),
                )


def resolve_workflow_assignee(
    conn: sqlite3.Connection,
    target_type: str,
    target_id: int,
    assignee_role: str,
) -> int | None:
    if target_type == "timesheet":
        row = conn.execute("SELECT user_id FROM timesheets WHERE id = ?", (target_id,)).fetchone()
    elif target_type == "overtime":
        row = conn.execute(
            """
            SELECT t.user_id
            FROM overtime_entries o
            JOIN timesheets t ON t.id = o.timesheet_id
            WHERE o.id = ?
            """,
            (target_id,),
        ).fetchone()
    else:
        row = None
    if not row:
        return None

    if assignee_role == "department_head":
        # Find the employee's department manager
        assignee = conn.execute(
            """
            SELECT COALESCE(p.manager_user_id, o.manager_user_id) AS reviewer_id
            FROM users u
            LEFT JOIN employee_profiles p ON p.user_id = u.id
            LEFT JOIN organizations o ON o.id = p.org_id
            WHERE u.id = ?
            """,
            (row["user_id"],),
        ).fetchone()
        reviewer_id = assignee["reviewer_id"] if assignee else None
        if reviewer_id:
            reviewer = conn.execute(
                "SELECT id FROM users WHERE id = ? AND is_active = 1",
                (reviewer_id,),
            ).fetchone()
            if reviewer:
                return int(reviewer["id"])
        return _fallback_admin(conn)

    if assignee_role == "project_owner":
        # Find the manager of the project's owning organization
        # First collect unique projects in this timesheet, then find their org managers
        projects = conn.execute(
            """
            SELECT DISTINCT e.project_id, p.owner_org_id
            FROM timesheet_entries e
            JOIN projects p ON p.id = e.project_id
            WHERE e.timesheet_id = ?
            """,
            (target_id,),
        ).fetchall()
        # Return the first valid project owner, or fallback
        for proj in projects:
            if proj["owner_org_id"]:
                org_mgr = conn.execute(
                    "SELECT manager_user_id FROM organizations WHERE id = ?",
                    (proj["owner_org_id"],),
                ).fetchone()
                if org_mgr and org_mgr["manager_user_id"]:
                    mgr = conn.execute(
                        "SELECT id FROM users WHERE id = ? AND is_active = 1",
                        (org_mgr["manager_user_id"],),
                    ).fetchone()
                    if mgr:
                        return int(mgr["id"])
        return _fallback_admin(conn)

    if assignee_role == "manager":
        # Legacy support: same as department_head
        return resolve_workflow_assignee(conn, target_type, target_id, "department_head")

    return None


def _fallback_admin(conn: sqlite3.Connection) -> int | None:
    fallback = conn.execute(
        """
        SELECT id
        FROM users
        WHERE is_active = 1
          AND (role = 'admin' OR name IN ('admin', '鞠松松') OR id = 18)
        ORDER BY CASE WHEN name = '鞠松松' OR id = 18 THEN 0 ELSE 1 END, id
        LIMIT 1
        """
    ).fetchone()
    return int(fallback["id"]) if fallback else None


def user_can_handle_task(conn: sqlite3.Connection, user: sqlite3.Row, workflow_key: str, target_type: str, target_id: int) -> bool:
    if is_admin(user):
        return True
    task = conn.execute(
        """
        SELECT assignee_user_id, assignee_role
        FROM workflow_tasks
        WHERE workflow_key = ?
          AND target_type = ?
          AND target_id = ?
          AND status = 'pending'
        """,
        (workflow_key, target_type, target_id),
    ).fetchone()
    if not task:
        return False
    if task["assignee_user_id"] is not None:
        return int(task["assignee_user_id"]) == int(user["id"])
    return task["assignee_role"] == user["role"]


def can_view_timesheet_detail(conn: sqlite3.Connection, user: sqlite3.Row | dict, timesheet_id: int) -> bool:
    if is_admin(user):
        return True
    row = conn.execute("SELECT user_id FROM timesheets WHERE id = ?", (timesheet_id,)).fetchone()
    if row and int(row["user_id"]) == int(user["id"]):
        return True
    pending = conn.execute(
        """
        SELECT 1
        FROM workflow_tasks
        WHERE workflow_key = 'timesheet'
          AND target_type = 'timesheet'
          AND target_id = ?
          AND status = 'pending'
          AND assignee_user_id = ?
        """,
        (timesheet_id, int(user["id"])),
    ).fetchone()
    if pending:
        return True
    reviewed = conn.execute(
        """
        SELECT 1
        FROM approval_logs
        WHERE target_type = 'timesheet'
          AND target_id = ?
          AND actor_id = ?
          AND action IN ('approve', 'reject', 'reopen')
        """,
        (timesheet_id, int(user["id"])),
    ).fetchone()
    return bool(reviewed)


def complete_workflow_tasks(
    conn: sqlite3.Connection,
    workflow_key: str,
    target_type: str,
    target_id: int,
    actor_id: int,
    action: str,
    comment: str,
) -> None:
    conn.execute(
        """
        UPDATE workflow_tasks
        SET status = 'completed',
            completed_by = ?,
            completed_at = ?,
            result_action = ?,
            comment = ?
        WHERE workflow_key = ?
          AND target_type = ?
          AND target_id = ?
          AND status = 'pending'
        """,
        (actor_id, datetime.now().isoformat(timespec="seconds"), action, comment, workflow_key, target_type, target_id),
    )


def insert_approval_log(
    conn: sqlite3.Connection,
    target_type: str,
    target_id: int,
    actor_id: int,
    action: str,
    comment: str,
    from_status: str,
    to_status: str,
) -> None:
    timesheet_id = target_id if target_type == "timesheet" else None
    if target_type == "overtime":
        row = conn.execute("SELECT timesheet_id FROM overtime_entries WHERE id = ?", (target_id,)).fetchone()
        timesheet_id = row["timesheet_id"] if row else target_id
    conn.execute(
        """
        INSERT INTO approval_logs(
          timesheet_id, target_type, target_id, from_status, to_status, actor_id, action, comment
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (timesheet_id, target_type, target_id, from_status, to_status, actor_id, action, comment),
    )


def run_workflow_transition(
    conn: sqlite3.Connection,
    workflow_key: str,
    target_id: int,
    action: str,
    user: sqlite3.Row,
    comment: str = "",
) -> dict:
    workflow = WORKFLOWS[workflow_key]
    transition = workflow["transitions"].get(action)
    if not transition:
        return {"ok": False, "message": "未知工作流动作。"}

    row = conn.execute(
        f"SELECT * FROM {workflow['table']} WHERE id = ?",
        (target_id,),
    ).fetchone()
    if not row:
        return {"ok": False, "message": "工作流对象不存在。"}

    current_status = row["status"]
    if current_status not in transition["from"]:
        return {"ok": False, "message": "当前状态不允许执行该操作。"}

    if user["role"] not in transition["roles"]:
        return {"ok": False, "message": "无权执行该工作流动作。"}

    if transition.get("owner_only") and row["user_id"] != user["id"]:
        return {"ok": False, "message": "只能提交自己的周表。"}

    if transition.get("complete_task") and not user_can_handle_task(
        conn,
        user,
        workflow_key,
        workflow["target_type"],
        target_id,
    ):
        return {"ok": False, "message": "该审批任务未分配给当前账号。"}

    for validator in transition.get("validators", ()):
        if validator == "daily_total_not_exceed_100":
            error = validate_day_totals(conn, target_id)
            if error:
                return {"ok": False, "message": f"{error}，不允许提交。"}

    to_status = transition["to"]
    return {
        "ok": True,
        "workflow": workflow,
        "transition": transition,
        "from_status": current_status,
        "to_status": to_status,
        "row": row,
    }


def employee_rows(conn: sqlite3.Connection) -> list[dict]:
    return dict_rows(
        conn.execute(
            """
            SELECT u.id, u.name, u.role, u.department, p.employee_no, p.position_name,
                   p.employment_type, p.contract_type, p.monthly_salary, p.daily_wage,
                   p.hire_date, p.contract_start,
                   p.contract_end, p.status, p.org_id, p.manager_user_id,
                   o.org_name, m.name AS manager_name
            FROM users u
            LEFT JOIN employee_profiles p ON p.user_id = u.id
            LEFT JOIN organizations o ON o.id = p.org_id
            LEFT JOIN users m ON m.id = p.manager_user_id
            WHERE u.is_active = 1
              AND u.name NOT IN ('admin')
              AND u.id NOT IN (
                SELECT user_id
                FROM auth_accounts
                WHERE login IN ('admin')
              )
            ORDER BY u.id
            """
        )
    )


class AppHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        safe_path = parsed.path.lstrip("/") or "index.html"
        target = STATIC_DIR / safe_path
        if target.exists() and target.is_file():
            return str(target)
        return str(STATIC_DIR / "index.html")

    def end_headers(self) -> None:
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return super().do_GET()

        query = parse_qs(parsed.query)
        with connect() as conn:
            user = cookie_user(self, conn)
            if parsed.path == "/api/me":
                return json_response(self, {"user": current_user_payload(user)})

            if parsed.path == "/api/bootstrap":
                visible_users = []
                if user and user["role"] in ("manager", "admin"):
                    visible_users = dict_rows(conn.execute("SELECT * FROM users WHERE is_active = 1 ORDER BY id"))
                payload = {
                    "users": visible_users,
                    "projects": dict_rows(conn.execute("SELECT * FROM projects WHERE status = 'active' ORDER BY code")),
                    "currentUser": current_user_payload(user),
                    "currentWeek": monday_of_week().isoformat(),
                    "recommendation": {
                        "demo": "SQLite",
                        "production": "Postgres 或 Supabase",
                        "reason": "Demo 零部署；正式系统需要更好的并发、权限、备份和审计。",
                    },
                }
                return json_response(self, payload)

            if parsed.path == "/api/organizations":
                if not require_user(self, user):
                    return
                if not is_admin(user):
                    return json_response(self, {"ok": False, "message": "无权访问员工与组织管理。"}, 403)
                return json_response(
                    self,
                    dict_rows(conn.execute("SELECT * FROM organizations ORDER BY parent_id, id")),
                )

            if parsed.path == "/api/employees":
                if not require_user(self, user):
                    return
                if not is_admin(user):
                    return json_response(self, {"ok": False, "message": "无权访问员工与组织管理。"}, 403)
                return json_response(self, employee_rows(conn))

            if parsed.path == "/api/overtime/pending":
                if not require_user(self, user):
                    return
                if not can_review(user):
                    return json_response(self, {"ok": False, "message": "无权访问加班审批。"}, 403)
                week_start = normalize_week_start(query.get("weekStart", [None])[0])
                return json_response(self, overtime_pending(conn, week_start, user))

            if parsed.path == "/api/approvals/tasks":
                if not require_user(self, user):
                    return
                if not can_review(user):
                    return json_response(self, {"ok": False, "message": "无权访问审批任务。"}, 403)
                week_start = normalize_week_start(query.get("weekStart", [None])[0])
                return json_response(self, approval_tasks(conn, week_start, user))

            if parsed.path == "/api/timesheet":
                if not require_user(self, user):
                    return
                user_id = user["id"]
                week_start = normalize_week_start(query.get("weekStart", [None])[0])
                return json_response(self, get_timesheet(conn, user_id, week_start))

            if parsed.path.startswith("/api/timesheet/"):
                if not require_user(self, user):
                    return
                try:
                    timesheet_id = int(parsed.path.rsplit("/", 1)[1])
                except ValueError:
                    return json_response(self, {"ok": False, "message": "周表编号无效。"}, 400)
                if not can_view_timesheet_detail(conn, user, timesheet_id):
                    return json_response(self, {"ok": False, "message": "无权查看该周表详情。"}, 403)
                sheet = get_timesheet_by_id(conn, timesheet_id)
                if not sheet:
                    return json_response(self, {"ok": False, "message": "周表不存在。"}, 404)
                return json_response(self, sheet)

            if parsed.path == "/api/timesheet-detail":
                if not require_user(self, user):
                    return
                try:
                    timesheet_id = int(query.get("timesheetId", [""])[0])
                except ValueError:
                    return json_response(self, {"ok": False, "message": "周表编号无效。"}, 400)
                if not can_view_timesheet_detail(conn, user, timesheet_id):
                    return json_response(self, {"ok": False, "message": "无权查看该周表详情。"}, 403)
                sheet = get_timesheet_by_id(conn, timesheet_id)
                if not sheet:
                    return json_response(self, {"ok": False, "message": "周表不存在。"}, 404)
                return json_response(self, sheet)

            if parsed.path == "/api/reports/weekly":
                if not require_user(self, user):
                    return
                if not can_review(user):
                    return json_response(self, {"ok": False, "message": "无权访问汇总报表。"}, 403)
                start_date = query.get("startDate", [None])[0]
                end_date = query.get("endDate", [None])[0]
                if start_date and end_date:
                    return json_response(self, weekly_report(conn, start_date, end_date))
                week_start = normalize_week_start(query.get("weekStart", [None])[0])
                week_end = (date.fromisoformat(week_start) + timedelta(days=6)).isoformat()
                return json_response(self, weekly_report(conn, week_start, week_end))

            if parsed.path == "/api/project-dashboard":
                if not require_user(self, user):
                    return
                if not can_review(user):
                    return json_response(self, {"ok": False, "message": "无权访问项目看板。"}, 403)
                week_start = normalize_week_start(query.get("weekStart", [None])[0])
                return json_response(self, project_dashboard(conn, week_start))

            if parsed.path == "/api/projects":
                if not require_user(self, user):
                    return
                if not can_review(user):
                    return json_response(self, {"ok": False, "message": "无权访问项目基础数据。"}, 403)
                return json_response(self, project_rows(conn))

            if parsed.path == "/api/project-detail":
                if not require_user(self, user):
                    return
                if not can_review(user):
                    return json_response(self, {"ok": False, "message": "无权访问项目详情。"}, 403)
                project_id = int(query.get("projectId", ["0"])[0])
                start_date = query.get("startDate", [""])[0]
                end_date = query.get("endDate", [""])[0]
                if not start_date or not end_date:
                    return json_response(self, {"ok": False, "message": "缺少日期范围参数。"}, 400)
                return json_response(self, project_detail(conn, project_id, start_date, end_date))

        return json_response(self, {"error": "Not found"}, 404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return json_response(self, {"error": "Not found"}, 404)

        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        with connect() as conn:
            if parsed.path == "/api/login":
                account = conn.execute(
                    """
                    SELECT a.*, u.is_active
                    FROM auth_accounts a
                    JOIN users u ON u.id = a.user_id
                    WHERE a.login = ?
                    """,
                    (payload.get("login", ""),),
                ).fetchone()
                if not account or not account["is_active"] or not verify_password(payload.get("password", ""), account["password_hash"]):
                    return json_response(self, {"ok": False, "message": "账号或密码不正确。"}, 401)
                token = secrets.token_urlsafe(32)
                expires = (datetime.now() + timedelta(days=7)).isoformat(timespec="seconds")
                conn.execute(
                    "INSERT INTO auth_sessions(token, user_id, expires_at) VALUES(?, ?, ?)",
                    (token, account["user_id"], expires),
                )
                body = json.dumps({"ok": True}, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                set_session_cookie(self, token)
                self.end_headers()
                self.wfile.write(body)
                return

            if parsed.path == "/api/logout":
                cookie = SimpleCookie(self.headers.get("Cookie", ""))
                morsel = cookie.get("attendance_sid")
                if morsel:
                    conn.execute("DELETE FROM auth_sessions WHERE token = ?", (morsel.value,))
                body = json.dumps({"ok": True}, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                clear_session_cookie(self)
                self.end_headers()
                self.wfile.write(body)
                return

            if parsed.path == "/api/password/change":
                return json_response(self, change_password(conn, payload))

            if parsed.path == "/api/timesheet/save":
                user = cookie_user(self, conn)
                if not require_user(self, user):
                    return
                saved = save_timesheet(conn, payload, user)
                return json_response(self, saved)

            if parsed.path == "/api/timesheet/action":
                user = cookie_user(self, conn)
                if not require_user(self, user):
                    return
                result = update_status(conn, payload, user)
                return json_response(self, result)

            if parsed.path == "/api/employees/save":
                user = cookie_user(self, conn)
                if not require_user(self, user):
                    return
                if not is_admin(user):
                    return json_response(self, {"ok": False, "message": "无权维护员工信息。"}, 403)
                return json_response(self, save_employee(conn, payload))

            if parsed.path == "/api/employees/delete":
                user = cookie_user(self, conn)
                if not require_user(self, user):
                    return
                if not is_admin(user):
                    return json_response(self, {"ok": False, "message": "无权删除员工。"}, 403)
                return json_response(self, delete_employee(conn, payload))

            if parsed.path == "/api/organizations/save":
                user = cookie_user(self, conn)
                if not require_user(self, user):
                    return
                if not is_admin(user):
                    return json_response(self, {"ok": False, "message": "无权维护部门信息。"}, 403)
                return json_response(self, save_organization(conn, payload))

            if parsed.path == "/api/organizations/delete":
                user = cookie_user(self, conn)
                if not require_user(self, user):
                    return
                if not is_admin(user):
                    return json_response(self, {"ok": False, "message": "无权删除部门。"}, 403)
                return json_response(self, delete_organization(conn, payload))

            if parsed.path == "/api/projects/save":
                user = cookie_user(self, conn)
                if not require_user(self, user):
                    return
                if not can_review(user):
                    return json_response(self, {"ok": False, "message": "无权维护项目基础数据。"}, 403)
                return json_response(self, save_project(conn, payload))

            if parsed.path == "/api/projects/delete":
                user = cookie_user(self, conn)
                if not require_user(self, user):
                    return
                if not can_review(user):
                    return json_response(self, {"ok": False, "message": "无权删除项目。"}, 403)
                return json_response(self, delete_project(conn, payload["id"]))

            if parsed.path == "/api/overtime/action":
                user = cookie_user(self, conn)
                if not require_user(self, user):
                    return
                if not can_review(user):
                    return json_response(self, {"ok": False, "message": "无权审批加班。"}, 403)
                return json_response(self, update_overtime_status(conn, payload, user))

        return json_response(self, {"error": "Not found"}, 404)


def save_timesheet(conn: sqlite3.Connection, payload: dict, user: sqlite3.Row) -> dict:
    user_id = int(user["id"])
    week_start = normalize_week_start(payload.get("weekStart"))
    timesheet_id = ensure_timesheet(conn, user_id, week_start)
    current = conn.execute("SELECT status FROM timesheets WHERE id = ?", (timesheet_id,)).fetchone()
    if current["status"] in ("submitted", "approved", "summarized"):
        return {"ok": False, "message": "当前状态不可编辑，请先退回或重新打开。"}

    conn.execute(
        "UPDATE timesheets SET remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (payload.get("remark", ""), timesheet_id),
    )
    conn.execute("DELETE FROM timesheet_entries WHERE timesheet_id = ?", (timesheet_id,))
    conn.execute(
        """
        DELETE FROM workflow_tasks
        WHERE target_type = 'overtime'
          AND status = 'pending'
          AND target_id IN (SELECT id FROM overtime_entries WHERE timesheet_id = ?)
        """,
        (timesheet_id,),
    )
    conn.execute("DELETE FROM overtime_entries WHERE timesheet_id = ?", (timesheet_id,))

    for entry in payload.get("entries", []):
        hours = round(float(entry.get("hours") or 0), 3)
        if hours <= 0:
            continue
        if hours > 1:
            return {"ok": False, "message": "单个项目在同一天不能超过 1 工日。"}
        conn.execute(
            """
            INSERT INTO timesheet_entries(timesheet_id, project_id, work_date, hours, description)
            VALUES(?, ?, ?, ?, ?)
            """,
            (
                timesheet_id,
                int(entry["projectId"]),
                entry["workDate"],
                hours,
                entry.get("description", ""),
            ),
        )

    for item in payload.get("overtime", []):
        overtime_hours = round(float(item.get("hours") or 0), 2)
        if overtime_hours <= 0:
            continue
        cur = conn.execute(
            """
            INSERT INTO overtime_entries(timesheet_id, work_date, overtime_hours, reason)
            VALUES(?, ?, ?, ?)
            """,
            (
                timesheet_id,
                item["workDate"],
                overtime_hours,
                item.get("reason", ""),
            ),
        )
        create_workflow_task(
            conn,
            "overtime",
            "overtime",
            int(cur.lastrowid),
            user_id,
            WORKFLOWS["overtime"]["review_role"],
        )
    return {"ok": True, "timesheet": get_timesheet(conn, user_id, week_start)}


def update_status(conn: sqlite3.Connection, payload: dict, user: sqlite3.Row) -> dict:
    timesheet_id = int(payload["timesheetId"])
    actor_id = int(user["id"])
    action = payload["action"]
    comment = payload.get("comment", "")
    result = run_workflow_transition(conn, "timesheet", timesheet_id, action, user, comment)
    if not result["ok"]:
        return result

    fields = ["status = ?", "updated_at = CURRENT_TIMESTAMP"]
    params: list[object] = [result["to_status"]]
    if action == "submit":
        fields.append("submitted_at = ?")
        params.append(datetime.now().isoformat(timespec="seconds"))
        fields.append("review_comment = ''")
    if action == "approve":
        fields.extend(["approved_by = ?", "approved_at = ?"])
        params.extend([actor_id, datetime.now().isoformat(timespec="seconds")])
    if action == "reject":
        fields.append("review_comment = ?")
        params.append(comment)
    if action == "reopen":
        fields.extend(["approved_by = NULL", "approved_at = NULL", "submitted_at = NULL", "review_comment = ?"])
        params.append(comment)
    params.append(timesheet_id)
    conn.execute(f"UPDATE timesheets SET {', '.join(fields)} WHERE id = ?", params)
    target_type = result["workflow"]["target_type"]
    if result["transition"].get("create_task"):
        # Multi-step routing: project_owner → department_head
        create_timesheet_approval_tasks(conn, timesheet_id, actor_id)
    if result["transition"].get("complete_task"):
        # Find and complete the task assigned to the current actor
        task_row = conn.execute(
            """SELECT id FROM workflow_tasks
               WHERE workflow_key = 'timesheet'
                 AND target_type = ?
                 AND target_id = ?
                 AND assignee_user_id = ?
                 AND status = 'pending'
               LIMIT 1""",
            (target_type, timesheet_id, actor_id),
        ).fetchone()

        if task_row:
            conn.execute(
                """UPDATE workflow_tasks
                   SET status = 'completed', completed_by = ?, completed_at = ?,
                       result_action = ?, comment = ?
                   WHERE id = ?""",
                (actor_id, datetime.now().isoformat(timespec="seconds"),
                 action, comment, task_row["id"]),
            )

        if action == "approve":
            # Check if all tasks are complete → timesheet approved
            pending = conn.execute(
                """SELECT COUNT(*) FROM workflow_tasks
                   WHERE workflow_key = 'timesheet'
                     AND target_type = ?
                     AND target_id = ?
                     AND status = 'pending'""",
                (target_type, timesheet_id),
            ).fetchone()[0]
            if pending == 0:
                result["to_status"] = "approved"
                conn.execute(
                    "UPDATE timesheets SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?",
                    (actor_id, datetime.now().isoformat(timespec="seconds"), timesheet_id),
                )
        elif action == "reject":
            # Cancel all remaining pending tasks
            conn.execute(
                """UPDATE workflow_tasks
                   SET status = 'completed', result_action = 'cancelled',
                       completed_by = ?, completed_at = ?
                   WHERE workflow_key = 'timesheet'
                     AND target_type = ?
                     AND target_id = ?
                     AND status = 'pending'""",
                (actor_id, datetime.now().isoformat(timespec="seconds"),
                 target_type, timesheet_id),
            )
    insert_approval_log(
        conn,
        target_type,
        timesheet_id,
        actor_id,
        action,
        comment,
        result["from_status"],
        result["to_status"],
    )
    row = conn.execute("SELECT user_id, week_start_date FROM timesheets WHERE id = ?", (timesheet_id,)).fetchone()
    return {"ok": True, "timesheet": get_timesheet(conn, row["user_id"], row["week_start_date"])}


def save_employee(conn: sqlite3.Connection, payload: dict) -> dict:
    user_id = int(payload.get("id") or 0) or None
    name = payload.get("name", "").strip()
    if not name:
        return {"ok": False, "message": "员工姓名不能为空。"}
    role = payload.get("role", "employee")
    if role not in ("employee", "manager", "admin"):
        return {"ok": False, "message": "未知人员类型。"}
    org_id = int(payload.get("orgId") or 0) or None
    org = conn.execute("SELECT org_name FROM organizations WHERE id = ?", (org_id,)).fetchone() if org_id else None
    department = org["org_name"] if org else payload.get("department", "")
    is_active = 1 if payload.get("status") != "terminated" else 0
    employee_no = payload.get("employeeNo") or None
    requested_login = (payload.get("login") or "").strip() or None
    existing_user = None
    existing_account = None
    if user_id:
        existing_user = conn.execute("SELECT id, name FROM users WHERE id = ?", (user_id,)).fetchone()
        existing_account = conn.execute("SELECT id, login FROM auth_accounts WHERE user_id = ?", (user_id,)).fetchone()
    login = requested_login
    if user_id and not login:
        if not existing_account:
            login = name
        elif existing_user and existing_account["login"] == existing_user["name"]:
            login = name
    if employee_no:
        duplicate = conn.execute(
            """
            SELECT p.user_id
            FROM employee_profiles p
            JOIN users u ON u.id = p.user_id
            WHERE p.employee_no = ?
              AND (? IS NULL OR p.user_id != ?)
            """,
            (employee_no, user_id, user_id),
        ).fetchone()
        if duplicate:
            return {"ok": False, "message": "员工编号已存在，请换一个编号。"}

    if login:
        duplicate_login = conn.execute(
            """
            SELECT a.user_id, u.is_active
            FROM auth_accounts a
            JOIN users u ON u.id = a.user_id
            WHERE a.login = ?
              AND (? IS NULL OR a.user_id != ?)
            """,
            (login, user_id, user_id),
        ).fetchone()
        if duplicate_login:
            return {"ok": False, "message": "登录账号已存在，请换一个账号。"}

    if user_id:
        if not existing_user:
            return {"ok": False, "message": "员工不存在。"}
        conn.execute(
            "UPDATE users SET name = ?, role = ?, department = ?, is_active = ? WHERE id = ?",
            (name, role, department, is_active, user_id),
        )
        if login:
            if existing_account:
                conn.execute("UPDATE auth_accounts SET login = ? WHERE user_id = ?", (login, user_id))
            else:
                conn.execute(
                    "INSERT INTO auth_accounts(user_id, login, password_hash) VALUES(?, ?, ?)",
                    (user_id, login, password_hash(payload.get("password") or "123456")),
                )
    else:
        cur = conn.execute(
            "INSERT INTO users(name, role, department, is_active) VALUES(?, ?, ?, ?)",
            (name, role, department, is_active),
        )
        user_id = cur.lastrowid
        login = login or name
        conn.execute(
            "INSERT INTO auth_accounts(user_id, login, password_hash) VALUES(?, ?, ?)",
            (user_id, login, password_hash(payload.get("password") or "123456")),
        )

    employee_no = employee_no or f"E{int(user_id):06d}"
    existing = conn.execute("SELECT id FROM employee_profiles WHERE user_id = ?", (user_id,)).fetchone()
    contract_type = payload.get("contractType", "labor")
    hire_date = payload.get("hireDate") or None
    contract_months = int(float(payload.get("contractMonths") or 0))
    contract_end = None
    if hire_date and contract_months > 0:
        contract_end = (add_months(date.fromisoformat(hire_date), contract_months) - timedelta(days=1)).isoformat()
    values = (
        employee_no,
        org_id,
        payload.get("positionName", ""),
        payload.get("employmentType", "labor"),
        contract_type,
        (float(payload.get("monthlySalary") or 0) or None) if contract_type != "service" else None,
        (float(payload.get("dailyWage") or 0) or None) if contract_type == "service" else None,
        26,
        hire_date,
        hire_date,
        contract_end,
        payload.get("status", "active"),
        int(payload.get("managerUserId") or 0) or None,
        int(user_id),
    )
    try:
        if existing:
            conn.execute(
                """
                UPDATE employee_profiles
                SET employee_no = ?, org_id = ?, position_name = ?, employment_type = ?,
                    contract_type = ?, monthly_salary = ?, daily_wage = ?,
                    standard_monthly_workdays = ?, hire_date = ?, contract_start = ?,
                    contract_end = ?, status = ?, manager_user_id = ?
                WHERE user_id = ?
                """,
                values,
            )
        else:
            conn.execute(
                """
                INSERT INTO employee_profiles(
                  employee_no, org_id, position_name, employment_type, contract_type,
                  monthly_salary, daily_wage, standard_monthly_workdays, hire_date,
                  contract_start, contract_end, status, manager_user_id, user_id
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )
    except sqlite3.IntegrityError as error:
        return {"ok": False, "message": f"人员信息保存失败：{error}"}
    return {"ok": True, "employees": employee_rows(conn)}


def delete_employee(conn: sqlite3.Connection, payload: dict) -> dict:
    user_id = int(payload["id"])
    conn.execute(
        """
        DELETE FROM workflow_tasks
        WHERE (target_type = 'timesheet' AND target_id IN (SELECT id FROM timesheets WHERE user_id = ?))
           OR (target_type = 'overtime' AND target_id IN (
                SELECT o.id
                FROM overtime_entries o
                JOIN timesheets t ON t.id = o.timesheet_id
                WHERE t.user_id = ?
           ))
           OR created_by = ?
           OR completed_by = ?
        """,
        (user_id, user_id, user_id, user_id),
    )
    conn.execute(
        """
        DELETE FROM approval_logs
        WHERE actor_id = ?
           OR timesheet_id IN (SELECT id FROM timesheets WHERE user_id = ?)
           OR (target_type = 'overtime' AND target_id IN (
                SELECT o.id
                FROM overtime_entries o
                JOIN timesheets t ON t.id = o.timesheet_id
                WHERE t.user_id = ?
           ))
        """,
        (user_id, user_id, user_id),
    )
    conn.execute("UPDATE timesheets SET approved_by = NULL WHERE approved_by = ?", (user_id,))
    conn.execute("UPDATE employee_profiles SET manager_user_id = NULL WHERE manager_user_id = ?", (user_id,))
    conn.execute("UPDATE organizations SET manager_user_id = NULL WHERE manager_user_id = ?", (user_id,))
    conn.execute("DELETE FROM timesheets WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM employee_profiles WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM auth_accounts WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"ok": True, "employees": employee_rows(conn)}


def save_organization(conn: sqlite3.Connection, payload: dict) -> dict:
    org_id = int(payload.get("id") or 0)
    org_name = payload.get("orgName", "").strip()
    if not org_name:
        return {"ok": False, "message": "部门名称不能为空。"}
    org_type = payload.get("orgType") or "department"
    if org_type not in ("company", "department"):
        return {"ok": False, "message": "未知部门类型。"}
    parent_id = int(payload.get("parentId") or 0) or None
    manager_user_id = int(payload.get("managerUserId") or 0) or None

    if org_id:
        conn.execute(
            """
            UPDATE organizations
            SET org_name = ?, org_type = ?, parent_id = ?, manager_user_id = ?
            WHERE id = ?
            """,
            (org_name, org_type, parent_id, manager_user_id, org_id),
        )
    else:
        next_number = conn.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM organizations").fetchone()[0]
        org_code = f"D{int(next_number):03d}"
        conn.execute(
            """
            INSERT INTO organizations(org_code, org_name, parent_id, org_type, manager_user_id)
            VALUES(?, ?, ?, ?, ?)
            """,
            (org_code, org_name, parent_id, org_type, manager_user_id),
        )

    return {
        "ok": True,
        "organizations": dict_rows(conn.execute("SELECT * FROM organizations ORDER BY parent_id, id")),
    }


def delete_organization(conn: sqlite3.Connection, payload: dict) -> dict:
    org_id = int(payload.get("id") or 0)
    org = conn.execute("SELECT id, org_name FROM organizations WHERE id = ?", (org_id,)).fetchone()
    if not org:
        return {"ok": False, "message": "部门不存在或已被删除。"}
    child = conn.execute("SELECT 1 FROM organizations WHERE parent_id = ? LIMIT 1", (org_id,)).fetchone()
    if child:
        return {"ok": False, "message": "该部门下还有子部门，请先调整或删除子部门。"}
    employee = conn.execute(
        """
        SELECT 1
        FROM employee_profiles p
        JOIN users u ON u.id = p.user_id
        WHERE p.org_id = ?
          AND u.is_active = 1
          AND COALESCE(p.status, 'active') != 'terminated'
        LIMIT 1
        """,
        (org_id,),
    ).fetchone()
    if employee:
        return {"ok": False, "message": "该部门下还有员工，请先调整员工部门后再删除。"}
    conn.execute(
        """
        UPDATE employee_profiles
        SET org_id = NULL
        WHERE org_id = ?
          AND (
            COALESCE(status, 'active') = 'terminated'
            OR user_id IN (SELECT id FROM users WHERE is_active = 0)
          )
        """,
        (org_id,),
    )
    conn.execute("DELETE FROM organizations WHERE id = ?", (org_id,))
    return {
        "ok": True,
        "organizations": dict_rows(conn.execute("SELECT * FROM organizations ORDER BY parent_id, id")),
    }


def approval_tasks(conn: sqlite3.Connection, week_start: str, user: sqlite3.Row | dict | None = None) -> dict:
    admin_view, reviewer_id = reviewer_filter(user)
    timesheets = dict_rows(
        conn.execute(
            """
            SELECT DISTINCT t.id AS timesheet_id,
                   t.user_id,
                   t.week_start_date, t.status, u.name, u.department,
                   COALESCE(SUM(e.hours), 0) AS total_hours,
                   t.submitted_at
            FROM workflow_tasks wt
            JOIN timesheets t ON t.id = wt.target_id
            JOIN users u ON u.id = t.user_id
            LEFT JOIN timesheet_entries e ON e.timesheet_id = t.id
            WHERE wt.workflow_key = 'timesheet'
              AND wt.target_type = 'timesheet'
              AND wt.status = 'pending'
              AND (? OR wt.assignee_user_id = ? OR wt.assignee_user_id IS NULL)
            GROUP BY t.id
            ORDER BY t.week_start_date ASC, u.name
            """,
            (int(admin_view), reviewer_id),
        )
    )
    reviewed = dict_rows(
        conn.execute(
            """
            SELECT t.id AS timesheet_id, t.week_start_date, t.status, t.review_comment,
                   u.name, u.department, COALESCE(SUM(e.hours), 0) AS total_hours,
                   l.actor_id AS reviewer_id, reviewer.name AS reviewer_name
            FROM timesheets t
            JOIN users u ON u.id = t.user_id
            LEFT JOIN approval_logs l ON l.id = (
              SELECT id FROM approval_logs
              WHERE target_type = 'timesheet'
                AND target_id = t.id
                AND action IN ('approve', 'reject')
              ORDER BY created_at DESC, id DESC
              LIMIT 1
            )
            LEFT JOIN users reviewer ON reviewer.id = l.actor_id
            LEFT JOIN timesheet_entries e ON e.timesheet_id = t.id
            WHERE t.status IN ('approved', 'rejected')
              AND (? OR l.actor_id = ?)
            GROUP BY t.id
            ORDER BY COALESCE(t.approved_at, t.updated_at) DESC, u.name
            """,
            (int(admin_view), reviewer_id),
        )
    )
    overtime = overtime_pending(conn, week_start, user)
    overtime_reviewed = dict_rows(
        conn.execute(
            """
            SELECT o.id, o.work_date, o.overtime_hours, o.reason, o.status, o.reject_comment,
                   t.id AS timesheet_id, t.status AS timesheet_status,
                   u.name AS user_name, u.department,
                   l.actor_id AS reviewer_id, reviewer.name AS reviewer_name
            FROM overtime_entries o
            JOIN timesheets t ON t.id = o.timesheet_id
            JOIN users u ON u.id = t.user_id
            LEFT JOIN approval_logs l ON l.id = (
              SELECT id FROM approval_logs
              WHERE target_type = 'overtime'
                AND target_id = o.id
                AND action IN ('approve', 'reject')
              ORDER BY created_at DESC, id DESC
              LIMIT 1
            )
            LEFT JOIN users reviewer ON reviewer.id = l.actor_id
            WHERE t.week_start_date = ?
              AND o.overtime_hours > 0
              AND o.status IN ('approved', 'rejected')
              AND (? OR l.actor_id = ?)
            ORDER BY COALESCE(o.approved_at, t.updated_at) DESC, o.work_date DESC, u.name
            """,
            (week_start, int(admin_view), reviewer_id),
        )
    )
    return {
        "timesheets": timesheets,
        "reviewed": reviewed,
        "overtime": overtime,
        "overtimeReviewed": overtime_reviewed,
    }


def overtime_pending(conn: sqlite3.Connection, week_start: str, user: sqlite3.Row | dict | None = None) -> list[dict]:
    admin_view, reviewer_id = reviewer_filter(user)
    return dict_rows(
        conn.execute(
            """
            SELECT wt.id AS task_id, o.id, o.work_date, o.overtime_hours, o.reason, o.status,
                   wt.assignee_user_id, reviewer.name AS assignee_name,
                   t.id AS timesheet_id, t.status AS timesheet_status,
                   u.name AS user_name, u.department
            FROM workflow_tasks wt
            JOIN overtime_entries o ON o.id = wt.target_id
            JOIN timesheets t ON t.id = o.timesheet_id
            JOIN users u ON u.id = t.user_id
            LEFT JOIN users reviewer ON reviewer.id = wt.assignee_user_id
            WHERE wt.workflow_key = 'overtime'
              AND wt.target_type = 'overtime'
              AND wt.status = 'pending'
              AND t.week_start_date = ?
              AND o.overtime_hours > 0
              AND o.status = 'pending'
              AND (? OR wt.assignee_user_id = ? OR wt.assignee_user_id IS NULL)
            ORDER BY o.work_date, u.name
            """,
            (week_start, int(admin_view), reviewer_id),
        )
    )


def update_overtime_status(conn: sqlite3.Connection, payload: dict, user: sqlite3.Row) -> dict:
    status = payload.get("status")
    action = "approve" if status == "approved" else "reject" if status == "rejected" else ""
    if action not in ("approve", "reject"):
        return {"ok": False, "message": "未知加班审批动作。"}
    overtime_id = int(payload["id"])
    comment = payload.get("comment", "")
    result = run_workflow_transition(conn, "overtime", overtime_id, action, user, comment)
    if not result["ok"]:
        return result
    conn.execute(
        """
        UPDATE overtime_entries
        SET status = ?, approved_by = ?, approved_at = ?, reject_comment = ?
        WHERE id = ?
        """,
        (
            result["to_status"],
            user["id"],
            datetime.now().isoformat(timespec="seconds"),
            comment,
            overtime_id,
        ),
    )
    complete_workflow_tasks(conn, "overtime", "overtime", overtime_id, user["id"], action, comment)
    insert_approval_log(
        conn,
        "overtime",
        overtime_id,
        user["id"],
        action,
        comment,
        result["from_status"],
        result["to_status"],
    )
    return {"ok": True}


def project_rows(conn: sqlite3.Connection) -> list[dict]:
    return dict_rows(
        conn.execute(
            """
            SELECT p.id, p.code, p.name, p.contract_amount, p.received_amount,
                   MAX(p.contract_amount - p.received_amount, 0) AS receivable_amount,
                   p.owner_org_id, o.org_name AS owner_org_name,
                   p.project_owner_id,
                   -- project owner: use project_owner_id directly, fallback to org manager
                   COALESCE(
                       po.name,
                       (SELECT u2.name FROM users u2 WHERE u2.id = o.manager_user_id),
                       '—'
                   ) AS project_owner_name,
                   COALESCE(labor.total_hours, 0) AS total_labor_hours,
                   COALESCE(labor.total_cost, 0) AS total_labor_cost,
                   p.status
            FROM projects p
            LEFT JOIN organizations o ON o.id = p.owner_org_id
            LEFT JOIN users po ON po.id = p.project_owner_id
            LEFT JOIN (
                SELECT e.project_id,
                       COALESCE(SUM(e.hours), 0) AS total_hours,
                       COALESCE(SUM(CASE
                           WHEN p2.contract_type = 'service' THEN e.hours * (p2.daily_wage)
                           ELSE e.hours * (p2.monthly_salary / CASE WHEN p2.standard_monthly_workdays > 0 THEN p2.standard_monthly_workdays ELSE 21.75 END)
                       END), 0) AS total_cost
                FROM timesheet_entries e
                JOIN timesheets t2 ON t2.id = e.timesheet_id
                JOIN users u2 ON u2.id = t2.user_id
                JOIN employee_profiles p2 ON p2.user_id = u2.id
                GROUP BY e.project_id
            ) labor ON labor.project_id = p.id
            WHERE p.status = 'active'
            ORDER BY p.code
            """
        )
    )


def save_project(conn: sqlite3.Connection, payload: dict) -> dict:
    project_id = int(payload.get("id") or 0) or None
    code = (payload.get("code") or "").strip()
    name = (payload.get("name") or "").strip()
    if not code or not name:
        return {"ok": False, "message": "项目编号和名称不能为空。"}
    contract_amount = float(payload.get("contractAmount") or payload.get("contract_amount") or 0)
    received_amount = float(payload.get("receivedAmount") or payload.get("received_amount") or 0)
    project_owner_id = int(payload.get("projectOwnerId") or 0) or None
    owner_org_id = int(payload.get("ownerOrgId") or 0) or None
    duplicate = conn.execute(
        "SELECT id FROM projects WHERE code = ? AND (? IS NULL OR id != ?)",
        (code, project_id, project_id),
    ).fetchone()
    if duplicate:
        return {"ok": False, "message": "项目编号已存在。"}
    if project_id:
        conn.execute(
            """
            UPDATE projects
            SET code = ?, name = ?, contract_amount = ?, received_amount = ?,
                project_owner_id = ?, owner_org_id = ?
            WHERE id = ?
            """,
            (code, name, contract_amount, received_amount,
             project_owner_id, owner_org_id, project_id),
        )
    else:
        conn.execute(
            """
            INSERT INTO projects(code, name, contract_amount, received_amount,
                                 project_owner_id, owner_org_id)
            VALUES(?, ?, ?, ?, ?, ?)
            """,
            (code, name, contract_amount, received_amount,
             project_owner_id, owner_org_id),
        )
    return {"ok": True, "projects": project_rows(conn)}


def project_dashboard(conn: sqlite3.Connection, week_start: str) -> dict:
    rows = dict_rows(
        conn.execute(
            """
            SELECT p.id, p.code, p.name, p.contract_amount, p.received_amount,
                   MAX(p.contract_amount - p.received_amount, 0) AS receivable_amount,
                   COALESCE(SUM(e.hours), 0) AS labor_days,
                   COALESCE(SUM(
                     CASE
                       WHEN ep.contract_type = 'service' THEN COALESCE(ep.daily_wage, 0) * e.hours
                       ELSE COALESCE(ep.monthly_salary, 0) / 26.0 * e.hours
                     END
                   ), 0) AS labor_cost,
                   COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN t.user_id END) AS people_count
            FROM projects p
            LEFT JOIN timesheets t ON t.week_start_date = ?
            LEFT JOIN timesheet_entries e ON e.timesheet_id = t.id AND e.project_id = p.id
            LEFT JOIN employee_profiles ep ON ep.user_id = t.user_id
            WHERE p.status = 'active'
            GROUP BY p.id
            ORDER BY labor_days DESC, p.code
            """,
            (week_start,),
        )
    )
    for row in rows:
        gross_profit = Number_safe(row["contract_amount"]) - Number_safe(row["labor_cost"])
        row["gross_profit"] = round(gross_profit, 2)
        row["gross_margin"] = round(gross_profit / Number_safe(row["contract_amount"]) * 100, 1) if Number_safe(row["contract_amount"]) else 0
    return {"weekStart": week_start, "projects": rows}


def Number_safe(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def weekly_report(conn: sqlite3.Connection, start_date: str, end_date: str) -> dict:
    employee_rows = dict_rows(
        conn.execute(
            """
            SELECT u.name, u.department, t.id AS timesheet_id, t.status,
                   COALESCE(SUM(e.hours), 0) AS total_hours
            FROM users u
            LEFT JOIN timesheets t ON t.user_id = u.id
            LEFT JOIN timesheet_entries e ON e.timesheet_id = t.id AND e.work_date BETWEEN ? AND ?
            WHERE u.role = 'employee'
            GROUP BY u.id, t.id
            ORDER BY u.id
            """,
            (start_date, end_date),
        )
    )
    project_rows = dict_rows(
        conn.execute(
            """
            SELECT p.code, p.name, COALESCE(SUM(e.hours), 0) AS total_hours,
                   COUNT(DISTINCT CASE WHEN e.id IS NOT NULL THEN t.user_id END) AS people_count
            FROM projects p
            LEFT JOIN timesheet_entries e ON e.project_id = p.id AND e.work_date BETWEEN ? AND ?
            LEFT JOIN timesheets t ON t.id = e.timesheet_id
            WHERE p.status = 'active'
            GROUP BY p.id
            HAVING total_hours > 0
            ORDER BY total_hours DESC
            """,
            (start_date, end_date),
        )
    )
    return {"startDate": start_date, "endDate": end_date, "employees": employee_rows, "projects": project_rows}


def project_detail(conn: sqlite3.Connection, project_id: int, start_date: str, end_date: str) -> list[dict]:
    return dict_rows(
        conn.execute(
            """
            SELECT u.id, u.name, u.department,
                   COALESCE(SUM(e.hours), 0) AS total_hours,
                   COUNT(DISTINCT e.work_date) AS work_days
            FROM users u
            JOIN timesheets t ON t.user_id = u.id
            JOIN timesheet_entries e ON e.timesheet_id = t.id
                AND e.project_id = ? AND e.work_date BETWEEN ? AND ?
            GROUP BY u.id
            ORDER BY total_hours DESC
            """,
            (project_id, start_date, end_date),
        )
    )


def delete_project(conn: sqlite3.Connection, project_id: int) -> dict:
    conn.execute("UPDATE projects SET status = 'deleted' WHERE id = ?", (project_id,))
    return {"ok": True, "projects": project_rows(conn)}


if __name__ == "__main__":
    host = os.environ.get("ATTENDANCE_HOST", "127.0.0.1")
    port = int(os.environ.get("ATTENDANCE_PORT", "8765"))

    if os.environ.get("LEGACY_HTTP") == "1":
        init_db()
        server = ThreadingHTTPServer((host, port), AppHandler)
        print(f"Attendance demo running at http://{host}:{port}")
        server.serve_forever()
    else:
        import uvicorn

        print(f"Attendance demo running with FastAPI/WebSocket at http://{host}:{port}")
        uvicorn.run("fastapi_app:api", host=host, port=port)
