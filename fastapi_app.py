from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta
from http.cookies import SimpleCookie
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import app as legacy


api = FastAPI(title="考勤统计模块")


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


@api.get("/api/reports/weekly")
async def weekly_report(request: Request, weekStart: str | None = None):
    user = require_user(request)
    if isinstance(user, JSONResponse):
        return user
    if not can_review(user):
        return error("无权访问汇总报表。", 403)
    with legacy.connect() as conn:
        return legacy.weekly_report(conn, legacy.normalize_week_start(weekStart))


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


api.mount("/assets", StaticFiles(directory=str(legacy.STATIC_DIR)), name="assets")


@api.get("/{path:path}")
async def spa(path: str):
    target = legacy.STATIC_DIR / (path or "index.html")
    if target.exists() and target.is_file():
        return FileResponse(target)
    return FileResponse(legacy.STATIC_DIR / "index.html")


app = api
