from __future__ import annotations

import json
import os
import secrets
import urllib.request
import urllib.error
from datetime import date, datetime, timedelta
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import app as legacy
import db

api = FastAPI(title="项目核算自动化系统")

ROOT = Path(__file__).resolve().parent
FRONTEND_DIST = ROOT / "frontend" / "dist"

# Allow the Vite dev server (port 5173) to access the API
api.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Auth utilities ----

def resolve_user_from_jwt(request: Request) -> dict | None:
    """Try to resolve user from Bearer JWT token."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    user_id = db.get_user_id_from_jwt(token)
    if not user_id:
        return None
    with db.get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT e.id, e.name, e.auth_user_id, ur.role
               FROM employees e
               LEFT JOIN user_roles ur ON ur.employee_id = e.id
               WHERE e.auth_user_id = %s AND e.is_active = TRUE""",
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "name": row[1], "auth_user_id": row[2], "role": row[3] or "employee"}

def resolve_user_from_cookie(request: Request) -> dict | None:
    """Fallback: resolve user from cookie (V0.10 compatibility)."""
    cookie_header = request.headers.get("cookie") or request.headers.get("Cookie", "")
    if not cookie_header:
        return None
    return legacy.get_user_from_cookie(cookie_header)

def get_current_user(request: Request) -> dict:
    """Resolve current user: JWT first, cookie fallback."""
    user = resolve_user_from_jwt(request)
    if user:
        return user
    user = resolve_user_from_cookie(request)
    if user:
        return user
    return {}

def require_user(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="请先登录。")
    return user

def can_review(user: dict) -> bool:
    return user.get("role") in ("manager", "admin") or user.get("name") in ("鞠松松", "admin")

def is_admin(user: dict) -> bool:
    return user.get("role") == "admin" or user.get("name") in ("鞠松松", "admin")

from fastapi import HTTPException


# ---- V0.11: Supabase Auth login ----
GOTRUE_URL = os.environ.get("GOTRUE_URL", "http://127.0.0.1:8777")
GOTRUE_ANON_KEY = os.environ.get("GOTRUE_ANON_KEY", "")


@api.post("/api/login")
async def login_v2(request: Request):
    """Login via Supabase GoTrue: login_name → login_name@psa.local → GoTrue token"""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="请求格式错误。")
    login = (body.get("login") or "").strip()
    password = (body.get("password") or "")
    if not login or not password:
        raise HTTPException(status_code=400, detail="请输入账号和密码。")

    # Map login_name to auth email
    with db.get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT auth_email FROM profiles WHERE login_name = %s", (login,))
        row = cur.fetchone()
    if row and row[0]:
        email = row[0]
    else:
        email = f"{login}@psa.local"

    # Call GoTrue token endpoint
    token_body = json.dumps({"email": email, "password": password, "gotrue_meta_security": {}}).encode()
    req = urllib.request.Request(
        f"{GOTRUE_URL}/token?grant_type=password",
        data=token_body,
        headers={"Content-Type": "application/json", "apikey": GOTRUE_ANON_KEY},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10)
        data = _json.loads(resp.read())
        access_token = data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=401, detail="登录失败：令牌无效。")
        # Set cookie for backward compat
        response = JSONResponse({"ok": True, "token": access_token})
        response.set_cookie(
            key="attendance_sid",
            value=access_token,
            httponly=True,
            samesite="lax",
            max_age=86400,
        )
        return response
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()[:200]
        raise HTTPException(status_code=401, detail=f"登录失败：账号或密码错误。")


@api.get("/api/bootstrap")
async def bootstrap_v2(request: Request):
    """Bootstrap data for V0.11: current user + projects + week info."""
    user = get_current_user(request)
    if not user:
        return {"currentUser": None, "users": [], "projects": [], "currentWeek": legacy.monday_of_week().isoformat()}

    with db.get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id, name, login_name, auth_user_id FROM profiles WHERE is_active = TRUE")
        users = [{"id": r[0], "name": r[1], "role": "employee", "department": ""} for r in cur.fetchall()]
        cur.execute("SELECT id, code, name FROM projects WHERE status = 'active' ORDER BY code")
        projects = [{"id": r[0], "code": r[1], "name": r[2]} for r in cur.fetchall()]

    return {
        "currentUser": {"id": user["id"], "name": user["name"], "role": user["role"], "department": "", "is_active": 1},
        "users": users,
        "projects": projects,
        "currentWeek": legacy.monday_of_week().isoformat(),
        "dbRecommendation": "V0.11 Supabase Postgres",
    }


class SyncHub:
    def __init__(self) -> None:
        self.connections: dict[WebSocket, dict[str, Any]] = {}
        self.version = 0

    async def connect(self, websocket: WebSocket, user: dict[str, Any], client_id: str) -> None:
        await websocket.accept()
        self.connections[websocket] = {"user": user, "client_id": client_id}
        await websocket.send_json({"type": "hello", "version": self.version})

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.pop(websocket, None)

    async def broadcast(self, modules: list[str], source_client_id: str | None = None) -> None:
        self.version += 1
        payload = {
            "type": "sync",
            "version": self.version,
            "modules": modules,
            "at": datetime.now().isoformat(timespec="seconds"),
            "sourceClientId": source_client_id,
        }
        stale: list[WebSocket] = []
        for websocket, meta in self.connections.items():
            if source_client_id and meta.get("client_id") == source_client_id:
                continue
            try:
                await websocket.send_json(payload)
            except RuntimeError:
                stale.append(websocket)
        for websocket in stale:
            self.disconnect(websocket)


hub = SyncHub()


@api.on_event("startup")
def startup() -> None:
    legacy.init_db()


def get_user_from_cookie(cookie_header: str | None) -> dict[str, Any] | None:
    cookie = SimpleCookie(cookie_header or "")
    morsel = cookie.get("attendance_sid")
    if not morsel:
        return None
    with legacy.connect() as conn:
        row = conn.execute(
            """
            SELECT u.*
            FROM auth_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > ?
            """,
            (morsel.value, datetime.now().isoformat(timespec="seconds")),
        ).fetchone()
    return dict(row) if row else None


def request_user(request: Request) -> dict[str, Any] | None:
    return get_user_from_cookie(request.headers.get("cookie"))


def error(message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse({"ok": False, "message": message}, status_code=status_code)


def require_user(request: Request) -> dict[str, Any] | JSONResponse:
    user = request_user(request)
    if not user:
        return error("请先登录。", 401)
    return user


def is_admin(user: dict[str, Any]) -> bool:
    return legacy.is_admin(user)


def can_review(user: dict[str, Any]) -> bool:
    return legacy.can_review(user)


def client_id(request: Request) -> str | None:
    return request.headers.get("x-client-id")


def row_user(user: dict[str, Any]) -> dict[str, Any]:
    return user


@api.middleware("http")
async def no_store_static(request: Request, call_next):
    response = await call_next(request)
    if not request.url.path.startswith("/api/") and not request.url.path.startswith("/ws/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@api.get("/api/me")
async def me(request: Request):
    return {"user": request_user(request)}


@api.get("/api/bootstrap")
async def bootstrap(request: Request):
    user = request_user(request)
    with legacy.connect() as conn:
        visible_users = []
        if user and user["role"] in ("manager", "admin"):
            visible_users = legacy.dict_rows(conn.execute("SELECT * FROM users WHERE is_active = 1 ORDER BY id"))
        return {
            "users": visible_users,
            "projects": legacy.dict_rows(conn.execute("SELECT * FROM projects WHERE status = 'active' ORDER BY code")),
            "currentUser": user,
            "currentWeek": legacy.monday_of_week().isoformat(),
            "recommendation": {
                "demo": "SQLite",
                "production": "Postgres 或 Supabase",
                "reason": "当前实时同步先用 FastAPI WebSocket；正式上云可迁到 Supabase/Postgres Realtime。",
            },
        }


@api.get("/api/organizations")
async def organizations(request: Request):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not is_admin(user):
        return error("无权访问员工与组织管理。", 403)
    with legacy.connect() as conn:
        return legacy.dict_rows(conn.execute("SELECT * FROM organizations ORDER BY parent_id, id"))


@api.get("/api/employees")
async def employees(request: Request):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not is_admin(user):
        return error("无权访问员工与组织管理。", 403)
    with legacy.connect() as conn:
        return legacy.employee_rows(conn)


@api.get("/api/overtime/pending")
async def overtime_pending(request: Request, weekStart: str | None = None):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权访问加班审批。", 403)
    with legacy.connect() as conn:
        return legacy.overtime_pending(conn, legacy.normalize_week_start(weekStart), row_user(user))


@api.get("/api/approvals/tasks")
async def approval_tasks(request: Request, weekStart: str | None = None):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权访问审批任务。", 403)
    with legacy.connect() as conn:
        return legacy.approval_tasks(conn, legacy.normalize_week_start(weekStart), row_user(user))


@api.get("/api/timesheet")
async def timesheet(request: Request, weekStart: str | None = None):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    with legacy.connect() as conn:
        return legacy.get_timesheet(conn, int(user["id"]), legacy.normalize_week_start(weekStart))


@api.get("/api/timesheet/{timesheet_id}")
async def timesheet_detail(request: Request, timesheet_id: int):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权查看他人周表。", 403)
    with legacy.connect() as conn:
        if not legacy.can_view_timesheet_detail(conn, row_user(user), timesheet_id):
            return error("无权查看该周表详情。", 403)
        sheet = legacy.get_timesheet_by_id(conn, timesheet_id)
        if not sheet:
            return error("周表不存在。", 404)
        return sheet


@api.get("/api/timesheet-detail")
async def timesheet_detail_query(request: Request, timesheetId: int):
    return await timesheet_detail(request, timesheetId)


@api.get("/api/reports/weekly")
async def weekly_report(request: Request, weekStart: str | None = None, startDate: str | None = None, endDate: str | None = None):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权访问汇总报表。", 403)
    with legacy.connect() as conn:
        if startDate and endDate:
            return legacy.weekly_report(conn, startDate, endDate)
        ws = legacy.normalize_week_start(weekStart)
        we = (date.fromisoformat(ws) + timedelta(days=6)).isoformat()
        return legacy.weekly_report(conn, ws, we)


@api.get("/api/project-detail")
async def project_detail_route(request: Request, projectId: int, startDate: str, endDate: str):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权访问项目详情。", 403)
    with legacy.connect() as conn:
        return legacy.project_detail(conn, projectId, startDate, endDate)


@api.get("/api/project-dashboard")
async def project_dashboard(request: Request, weekStart: str | None = None):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权访问项目看板。", 403)
    with legacy.connect() as conn:
        return legacy.project_dashboard(conn, legacy.normalize_week_start(weekStart))


@api.get("/api/projects")
async def projects(request: Request):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权访问项目基础数据。", 403)
    with legacy.connect() as conn:
        return legacy.project_rows(conn)


@api.post("/api/projects/save")
async def projects_save(request: Request, payload: dict[str, Any]):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权维护项目基础数据。", 403)
    with legacy.connect() as conn:
        result = legacy.save_project(conn, payload)
    if result.get("ok"):
        await hub.broadcast(["dashboard", "reports"], client_id(request))
    return result


@api.post("/api/projects/delete")
async def projects_delete(request: Request, payload: dict[str, Any]):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权删除项目。", 403)
    with legacy.connect() as conn:
        result = legacy.delete_project(conn, payload["id"])
    if result.get("ok"):
        await hub.broadcast(["reports"], client_id(request))
    return result


@api.post("/api/login")
async def login(payload: dict[str, Any]):
    with legacy.connect() as conn:
        account = conn.execute(
            """
            SELECT a.*, u.is_active
            FROM auth_accounts a
            JOIN users u ON u.id = a.user_id
            WHERE a.login = ?
            """,
            (payload.get("login", ""),),
        ).fetchone()
        if not account or not account["is_active"] or not legacy.verify_password(payload.get("password", ""), account["password_hash"]):
            return error("账号或密码不正确。", 401)
        token = secrets.token_urlsafe(32)
        expires = (datetime.now() + timedelta(days=7)).isoformat(timespec="seconds")
        conn.execute("INSERT INTO auth_sessions(token, user_id, expires_at) VALUES(?, ?, ?)", (token, account["user_id"], expires))
    response = JSONResponse({"ok": True})
    response.set_cookie("attendance_sid", token, httponly=True, samesite="lax", path="/")
    return response


@api.post("/api/logout")
async def logout(request: Request):
    cookie = SimpleCookie(request.headers.get("cookie", ""))
    morsel = cookie.get("attendance_sid")
    if morsel:
        with legacy.connect() as conn:
            conn.execute("DELETE FROM auth_sessions WHERE token = ?", (morsel.value,))
    response = JSONResponse({"ok": True})
    response.delete_cookie("attendance_sid", path="/")
    return response


@api.post("/api/password/change")
async def password_change(payload: dict[str, Any]):
    with legacy.connect() as conn:
        return legacy.change_password(conn, payload)


@api.post("/api/timesheet/save")
async def save_timesheet(request: Request, payload: dict[str, Any]):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    with legacy.connect() as conn:
        result = legacy.save_timesheet(conn, payload, row_user(user))
    if result.get("ok"):
        await hub.broadcast(["timesheet", "approvals", "reports"], client_id(request))
    return result


@api.post("/api/timesheet/action")
async def timesheet_action(request: Request, payload: dict[str, Any]):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    with legacy.connect() as conn:
        result = legacy.update_status(conn, payload, row_user(user))
    if result.get("ok"):
        await hub.broadcast(["timesheet", "approvals", "reports"], client_id(request))
    return result


@api.post("/api/employees/save")
async def employees_save(request: Request, payload: dict[str, Any]):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not is_admin(user):
        return error("无权维护员工信息。", 403)
    with legacy.connect() as conn:
        result = legacy.save_employee(conn, payload)
    if result.get("ok"):
        await hub.broadcast(["employees", "organizations", "reports", "approvals"], client_id(request))
    return result


@api.post("/api/employees/delete")
async def employees_delete(request: Request, payload: dict[str, Any]):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not is_admin(user):
        return error("无权删除员工。", 403)
    with legacy.connect() as conn:
        result = legacy.delete_employee(conn, payload)
    if result.get("ok"):
        await hub.broadcast(["employees", "organizations", "reports", "approvals"], client_id(request))
    return result


@api.post("/api/organizations/save")
async def organizations_save(request: Request, payload: dict[str, Any]):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not is_admin(user):
        return error("无权维护部门信息。", 403)
    with legacy.connect() as conn:
        result = legacy.save_organization(conn, payload)
    if result.get("ok"):
        await hub.broadcast(["organizations", "employees"], client_id(request))
    return result


@api.post("/api/organizations/delete")
async def organizations_delete(request: Request, payload: dict[str, Any]):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not is_admin(user):
        return error("无权删除部门。", 403)
    with legacy.connect() as conn:
        result = legacy.delete_organization(conn, payload)
    if result.get("ok"):
        await hub.broadcast(["organizations", "employees"], client_id(request))
    return result


@api.post("/api/overtime/action")
async def overtime_action(request: Request, payload: dict[str, Any]):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权审批加班。", 403)
    with legacy.connect() as conn:
        result = legacy.update_overtime_status(conn, payload, row_user(user))
    if result.get("ok"):
        await hub.broadcast(["timesheet", "approvals", "reports"], client_id(request))
    return result


@api.websocket("/ws/sync")
async def websocket_sync(websocket: WebSocket):
    user = get_user_from_cookie(websocket.headers.get("cookie"))
    if not user:
        await websocket.close(code=1008)
        return
    client_id_value = websocket.query_params.get("clientId") or secrets.token_urlsafe(8)
    await hub.connect(websocket, user, client_id_value)
    try:
        while True:
            message = await websocket.receive_text()
            if message == "ping":
                await websocket.send_json({"type": "pong", "version": hub.version})
    except WebSocketDisconnect:
        hub.disconnect(websocket)


# Serve built frontend assets (JS/CSS chunks)
if (FRONTEND_DIST / "assets").exists():
    api.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST / "assets")),
        name="frontend_assets",
    )
else:
    # Fallback for local dev without built frontend
    api.mount(
        "/assets",
        StaticFiles(directory=str(legacy.STATIC_DIR)),
        name="legacy_assets",
    )


@api.get("/{path:path}")
async def spa(path: str):
    # Serve new React frontend (SPA) if built
    if FRONTEND_DIST.exists():
        target = FRONTEND_DIST / (path or "index.html")
        if target.exists() and target.is_file():
            return FileResponse(target)
        return FileResponse(FRONTEND_DIST / "index.html")

    # Fallback: old vanilla frontend
    target = legacy.STATIC_DIR / (path or "index.html")
    if target.exists() and target.is_file():
        return FileResponse(target)
    return FileResponse(legacy.STATIC_DIR / "index.html")


app = api
