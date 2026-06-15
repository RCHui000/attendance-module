import hashlib, hmac, json, os, re, time, base64
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin


ROOT = Path("/app")
SUPABASE_AUTH_URL = os.environ.get("SUPABASE_AUTH_URL", "http://192.168.2.100:8777").rstrip("/")
SUPABASE_REST_URL = os.environ.get("SUPABASE_REST_URL", "http://192.168.2.100:8779").rstrip("/")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
GOTRUE_URL = os.environ.get("GOTRUE_URL", "http://192.168.2.100:8777").rstrip("/")
DEFAULT_INITIAL_PASSWORD = os.environ["DEFAULT_INITIAL_PASSWORD"]  # must be set in env, no default
SUPERUSER_NAMES = {"admin", "鞠松松"}
SUPERUSER_IDS = {18}
HOP_BY_HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate",
    "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade",
}


def make_service_role_token():
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({
        "role": "service_role", "iss": "supabase",
        "aud": "authenticated",
        "iat": int(time.time()), "exp": int(time.time()) + 30,
    }).encode()).rstrip(b"=").decode()
    sig = base64.urlsafe_b64encode(
        hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    return f"{header}.{payload}.{sig}"


class SpaHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if self._proxy_supabase(): return
        super().do_GET()
    def do_HEAD(self) -> None:
        if self._proxy_supabase(): return
        super().do_HEAD()
    def do_POST(self) -> None:
        if self.path == "/api/create-employee-with-login":
            self._handle_create_employee()
            return
        if self.path == "/api/change-password":
            self._handle_change_password()
            return
        if self._proxy_supabase(): return
        self.send_error(404)
    def do_PATCH(self) -> None:
        if self._proxy_supabase(): return
        self.send_error(404)
    def do_DELETE(self) -> None:
        if self._proxy_supabase(): return
        self.send_error(404)
    def do_OPTIONS(self) -> None:
        if self._proxy_supabase(): return
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, OPTIONS, POST, PATCH, DELETE")
        self.end_headers()

    def end_headers(self) -> None:
        if self.path == "/" or self.path.endswith(".html"):
            self.send_header("Cache-Control", "no-store")
        elif self.path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        translated = Path(super().translate_path(path))
        return str(ROOT / "index.html") if not translated.exists() else str(translated)

    def _handle_create_employee(self) -> None:
        """POST /api/create-employee-with-login
        Atomically: validate admin JWT → create GoTrue user → write business tables → link auth UUID.
        Returns {ok, employee_id, login_name, initial_password}."""
        auth_uid = None   # for rollback on partial failure
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = json.loads(self.rfile.read(length)) if length else {}

            # ── 1. Validate admin JWT ──
            auth_header = self.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                self._json_error(401, "Not authenticated"); return
            user_id = self._jwt_sub(auth_header[7:])
            if not user_id:
                self._json_error(401, "Invalid token"); return
            if not self._has_role(user_id, "admin", auth_header[7:]):
                self._json_error(403, "Admin only"); return

            # ── 2. Validate inputs ──
            name = (body.get("name") or "").strip()
            if not name:
                self._json_error(400, "Employee name is required"); return
            if not (body.get("employeeNo") or body.get("employee_no")) and (body.get("orgId") or body.get("org_id")):
                body["employeeNo"] = self._next_employee_no(body.get("orgId") or body.get("org_id"), auth_header[7:])
            if not (body.get("loginName") or body.get("login_name")) and not (body.get("employeeNo") or body.get("employee_no")):
                next_eid = self._next_employee_id(auth_header[7:])
                body["_employee_id"] = next_eid
                body["employeeNo"] = f"QS{str(next_eid).zfill(6)}"
            login_name = self._login_name_for_new_employee(body, name)
            email = self._auth_email_for_login(login_name)
            password = DEFAULT_INITIAL_PASSWORD

            # ── 3. Check uniqueness ──
            if self._rest_get(f"/profiles?login_name=eq.{self._q(login_name)}&limit=1"):
                self._json_error(409, f"Login name '{login_name}' already exists"); return

            # ── 4. Create GoTrue user ──
            token = make_service_role_token()
            req_body = json.dumps({
                "email": email, "password": password,
                "role": "authenticated",
                "email_confirm": True,
                "app_metadata": {"role": "authenticated"},
                "user_metadata": {"login_name": login_name},
            }).encode()
            req = urllib.request.Request(
                f"{GOTRUE_URL}/admin/users", data=req_body,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            )
            resp = urllib.request.urlopen(req, timeout=15)
            auth_uid = json.loads(resp.read())["id"]

            # ── 5. Write business tables ──
            try:
                body["auth_user_id"] = auth_uid
                employee_id = self._write_employee(body, login_name, email, auth_header[7:])
            except Exception as be:
                # Rollback both sides. Business rows are written through PostgREST one by one,
                # so a later failure must not leave an employee pointing at a deleted auth user.
                self._delete_employee_business_rows(body.get("_employee_id"), auth_uid)
                self._delete_auth_user(auth_uid)
                raise be

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True, "employee_id": employee_id,
                "login_name": login_name,
                "initial_password": password,
            }).encode())

        except urllib.error.HTTPError as e:
            self._json_error(e.code, e.read().decode()[:300])
        except Exception as e:
            self._json_error(500, str(e))

    # ── helpers ──

    def _login_name_for_new_employee(self, body: dict, name: str) -> str:
        candidates = [
            body.get("loginName") or body.get("login_name") or "",
            body.get("employeeNo") or body.get("employee_no") or "",
            name,
        ]
        for candidate in candidates:
            compact = re.sub(r"\s+", "", str(candidate or ""))
            if "@" in compact and re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", compact):
                return compact.lower()
            if re.fullmatch(r"[A-Za-z0-9._+-]+", compact):
                return compact
        return f"user{int(time.time() * 1000)}"

    def _auth_email_for_login(self, login_name: str) -> str:
        login = (login_name or "").strip()
        if "@" in login and re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", login):
            return login.lower()
        local = re.sub(r"[^A-Za-z0-9._+-]+", "", login).strip(".").lower()
        if not local:
            local = f"user{int(time.time() * 1000)}"
        return f"{local}@psa.local"

    def _next_employee_id(self, bearer_token: str) -> int:
        existing = self._rest_get("/employees?select=id&order=id.desc&limit=1", bearer_token)
        return int(existing[0]["id"]) + 1 if existing else 1

    def _current_year_suffix(self) -> str:
        return time.strftime("%y")

    def _number_prefix(self, value: str | None) -> str:
        return re.sub(r"[^A-Za-z0-9]+", "", str(value or "")).upper()

    def _next_code(self, rows: list, field: str, prefix: str) -> str:
        clean_prefix = self._number_prefix(prefix)
        if not clean_prefix:
            return ""
        year = self._current_year_suffix()
        base = f"{clean_prefix}{year}"
        pattern = re.compile(rf"^{re.escape(base)}(\d{{3}})$", re.IGNORECASE)
        max_seq = 0
        for row in rows:
            match = pattern.match(str(row.get(field) or ""))
            if match:
                max_seq = max(max_seq, int(match.group(1)))
        return f"{base}{str(max_seq + 1).zfill(3)}"

    def _next_employee_no(self, org_id: str | int | None, bearer_token: str) -> str:
        if not org_id:
            return ""
        org_rows = self._rest_get(
            f"/organizations?select=org_code,org_name&id=eq.{self._q(str(org_id))}&limit=1",
            bearer_token,
        )
        org = org_rows[0] if org_rows else {}
        prefix = self._number_prefix(org.get("org_code")) or self._number_prefix(org.get("org_name")) or f"D{str(org_id).zfill(3)}"
        rows = self._rest_get(
            f"/employees?select=employee_no&employee_no=like.{self._q(prefix + self._current_year_suffix() + '%')}",
            bearer_token,
        )
        return self._next_code(rows, "employee_no", prefix)

    def _jwt_sub(self, token_str: str) -> str | None:
        try:
            parts = token_str.split(".")
            if len(parts) != 3: return None
            payload_b64 = parts[1] + "=="
            payload = json.loads(base64.urlsafe_b64decode(payload_b64))
            return payload.get("sub") if payload.get("exp", 0) > time.time() else None
        except Exception:
            return None

    def _has_role(self, auth_uid: str, role: str, bearer_token: str | None = None) -> bool:
        employee = self._employee_from_auth(auth_uid, bearer_token)
        employee_id = int(employee.get("id") or 0) if employee else 0
        if role == "admin" and (
            employee_id in SUPERUSER_IDS or employee.get("name") in SUPERUSER_NAMES
        ):
            return True
        rows = self._rest_get(
            f"/user_roles?select=role&employee_id=eq.{self._q(str(employee_id))}&role=eq.{self._q(role)}",
            bearer_token,
        )
        return len(rows) > 0

    def _employee_from_auth(self, auth_uid: str, bearer_token: str | None = None) -> dict:
        rows = self._rest_get(
            f"/employees?select=id,name&auth_user_id=eq.{self._q(auth_uid)}&limit=1",
            bearer_token,
        )
        return rows[0] if rows else {}

    def _employee_id_from_auth(self, auth_uid: str) -> int:
        rows = self._rest_get(f"/employees?select=id&auth_user_id=eq.{self._q(auth_uid)}&limit=1")
        return int(rows[0]["id"]) if rows else 0

    def _rest_get(self, path: str, bearer_token: str | None = None) -> list:
        req = urllib.request.Request(
            f"{SUPABASE_REST_URL}{path}",
            headers={"Authorization": f"Bearer {bearer_token or make_service_role_token()}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError:
            return []

    def _write_employee(self, body: dict, login_name: str, email: str, bearer_token: str) -> int:
        name = body["name"]
        contract_type = body.get("contractType") or body.get("contract_type") or "labor"
        # Get next ID
        eid = int(body.get("_employee_id") or 0) or self._next_employee_id(bearer_token)
        body["_employee_id"] = eid

        # employees
        employee_no = body.get("employeeNo") or body.get("employee_no")
        if not employee_no and (body.get("orgId") or body.get("org_id")):
            employee_no = self._next_employee_no(body.get("orgId") or body.get("org_id"), bearer_token)
        self._rest_post("/employees", [{"id": eid, "employee_no": employee_no or f"QS{str(eid).zfill(6)}", "name": name, "auth_user_id": body["auth_user_id"], "is_active": True}], bearer_token)
        # profiles
        self._rest_post("/profiles", [{"login_name": login_name, "auth_email": email, "auth_user_id": body["auth_user_id"], "display_name": name, "is_active": True, "must_change_password": True}], bearer_token)
        # profiles
        self._rest_post("/employee_profiles", [{"employee_id": eid, "org_id": body.get("orgId") or body.get("org_id") or None, "position_name": body.get("positionName") or body.get("position_name") or "", "cost_specialty": body.get("costSpecialty") or body.get("cost_specialty") or None, "employment_status": body.get("status") or "active", "manager_user_id": body.get("managerUserId") or body.get("manager_user_id") or None, "hire_date": body.get("hireDate") or body.get("hire_date") or None}], bearer_token)
        # contracts
        self._rest_post("/employee_contracts", [{"employee_id": eid, "contract_type": contract_type, "employment_type": body.get("employmentType") or body.get("employment_type") or "labor", "is_current": True}], bearer_token)
        # salary
        self._rest_post("/employee_salary_profiles", [{"employee_id": eid, "salary_mode": "daily_wage" if contract_type == "service" else "monthly_salary", "monthly_salary": 0 if contract_type == "service" else int(body.get("monthlySalary") or body.get("monthly_salary") or 0), "daily_wage": int(body.get("dailyWage") or body.get("daily_wage") or 0) if contract_type == "service" else 0, "is_current": True}], bearer_token)
        # roles
        self._rest_post("/user_roles", [{"employee_id": eid, "role": body.get("role") or "employee"}], bearer_token)
        return eid

    def _rest_post(self, path: str, data: list, bearer_token: str | None = None) -> None:
        req = urllib.request.Request(f"{SUPABASE_REST_URL}{path}", data=json.dumps(data).encode(), headers={"Content-Type": "application/json", "Prefer": "return=minimal", "Authorization": f"Bearer {bearer_token or make_service_role_token()}"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            pass  # fire-and-forget, errors raise HTTPError

    def _delete_auth_user(self, uid: str) -> None:
        try:
            token = make_service_role_token()
            req = urllib.request.Request(f"{GOTRUE_URL}/admin/users/{uid}", headers={"Authorization": f"Bearer {token}"}, method="DELETE")
            urllib.request.urlopen(req, timeout=10)
        except Exception:
            pass  # best-effort rollback

    def _delete_employee_business_rows(self, employee_id: int | None, auth_uid: str | None) -> None:
        try:
            if employee_id:
                eid = self._q(str(employee_id))
                self._rest_delete(f"/user_roles?employee_id=eq.{eid}")
                self._rest_delete(f"/employee_salary_profiles?employee_id=eq.{eid}")
                self._rest_delete(f"/employee_contracts?employee_id=eq.{eid}")
                self._rest_delete(f"/employee_profiles?employee_id=eq.{eid}")
                self._rest_delete(f"/employees?id=eq.{eid}")
            if auth_uid:
                uid = self._q(auth_uid)
                self._rest_delete(f"/profiles?auth_user_id=eq.{uid}")
        except Exception:
            pass  # best-effort rollback

    def _rest_delete(self, path: str) -> None:
        req = urllib.request.Request(
            f"{SUPABASE_REST_URL}{path}",
            headers={"Authorization": f"Bearer {make_service_role_token()}"},
            method="DELETE",
        )
        with urllib.request.urlopen(req, timeout=10):
            pass

    @staticmethod
    def _q(s: str) -> str:
        return urllib.request.quote(str(s), safe="")

    def _assert_login_enabled(self, email: str) -> None:
        profiles = self._rest_get(
            f"/profiles?select=auth_user_id,is_active&auth_email=eq.{self._q(email)}&limit=1",
        )
        if not profiles:
            return
        profile = profiles[0]
        if profile.get("is_active") is False:
            raise PermissionError("账户已停用，请联系管理员")

        auth_uid = profile.get("auth_user_id")
        if not auth_uid:
            raise PermissionError("账户未关联员工，请联系管理员")

        employees = self._rest_get(
            f"/employees?select=id,is_active&auth_user_id=eq.{self._q(auth_uid)}&limit=1",
        )
        if not employees:
            raise PermissionError("账户未关联员工，请联系管理员")
        employee = employees[0]
        if employee.get("is_active") is False:
            raise PermissionError("账户已停用，请联系管理员")

        employee_id = employee.get("id")
        profile_rows = self._rest_get(
            f"/employee_profiles?select=employment_status&employee_id=eq.{self._q(employee_id)}&limit=1",
        )
        employment_status = str((profile_rows[0] if profile_rows else {}).get("employment_status") or "active").strip().lower()
        if employment_status in {"terminated", "inactive", "resigned", "离职", "已离职"}:
            raise PermissionError("离职人员账户已关闭，请联系管理员")

    def _handle_change_password(self) -> None:
        """POST /api/change-password {oldPassword, newPassword}
        Verify old → change via GoTrue → clear must_change_password."""
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = json.loads(self.rfile.read(length)) if length else {}
            old_pw = body.get("oldPassword", "")
            new_pw = body.get("newPassword", "")
            if not old_pw or not new_pw:
                self._json_error(400, "oldPassword and newPassword required"); return

            # Get user email: try JWT first, then login_name from body
            email = ""
            auth_header = self.headers.get("Authorization", "")
            if auth_header.startswith("Bearer ") and auth_header[7:]:
                email = self._jwt_email(auth_header[7:]) or ""
            if not email:
                login = (body.get("login") or "").strip()
                if login:
                    email = self._login_to_email(login)
            if not email:
                self._json_error(401, "Not authenticated"); return

            # Step 1: verify old password
            verify_body = json.dumps({"email": email, "password": old_pw, "gotrue_meta_security": {}}).encode()
            req = urllib.request.Request(
                f"{GOTRUE_URL}/token?grant_type=password", data=verify_body,
                headers={"Content-Type": "application/json"},
            )
            resp = urllib.request.urlopen(req, timeout=10)
            fresh_token = json.loads(resp.read())["access_token"]

            # Step 2: change password using fresh token
            change_body = json.dumps({"password": new_pw}).encode()
            req2 = urllib.request.Request(
                f"{GOTRUE_URL}/user", data=change_body,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {fresh_token}"},
                method="PUT",
            )
            urllib.request.urlopen(req2, timeout=10)

            # Step 3: clear must_change_password in profiles
            sub = self._jwt_sub(auth_header[7:])
            if sub:
                self._rest_patch(f"/profiles?auth_user_id=eq.{self._q(sub)}", {"must_change_password": False})

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())

        except urllib.error.HTTPError as e:
            self._json_error(e.code, "Invalid credentials" if e.code == 400 else e.read().decode()[:200])
        except Exception as e:
            self._json_error(500, str(e))

    def _login_to_email(self, login: str) -> str:
        """Resolve login aliases from DB instead of relying on frontend hardcoding."""
        value = (login or "").strip()
        if "@" in value and re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            return value.lower()

        for field in ("login_name", "display_name"):
            rows = self._rest_get(
                f"/profiles?select=auth_email&{field}=eq.{self._q(value)}&is_active=eq.true&limit=1",
            )
            if rows and rows[0].get("auth_email"):
                return rows[0]["auth_email"]

        employee_rows = self._rest_get(
            f"/employees?select=auth_user_id&or=(name.eq.{self._q(value)},employee_no.eq.{self._q(value)})&is_active=eq.true&limit=1",
        )
        if employee_rows and employee_rows[0].get("auth_user_id"):
            profile_rows = self._rest_get(
                f"/profiles?select=auth_email&auth_user_id=eq.{self._q(employee_rows[0]['auth_user_id'])}&limit=1",
            )
            if profile_rows and profile_rows[0].get("auth_email"):
                return profile_rows[0]["auth_email"]

        local = re.sub(r"[^A-Za-z0-9._+-]+", "", value).strip(".").lower()
        return f"{local or value}@psa.local"

    def _jwt_email(self, token_str: str) -> str | None:
        try:
            parts = token_str.split(".")
            if len(parts) != 3: return None
            payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=="))
            return payload.get("email") if payload.get("exp", 0) > time.time() else None
        except Exception:
            return None

    def _rest_patch(self, path: str, data: dict) -> None:
        req = urllib.request.Request(f"{SUPABASE_REST_URL}{path}", data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json", "Prefer": "return=minimal", "Authorization": f"Bearer {make_service_role_token()}"}, method="PATCH")
        urllib.request.urlopen(req, timeout=10)

    def _json_error(self, code: int, msg: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": False, "message": msg}).encode())

    def _proxy_supabase(self) -> bool:
        if self.path.startswith("/auth/v1/"):
            self._forward(SUPABASE_AUTH_URL, "/auth/v1"); return True
        if self.path.startswith("/auth/"):
            self._forward(SUPABASE_AUTH_URL, "/auth"); return True
        if self.path.startswith("/rest/v1/"):
            self._forward(SUPABASE_REST_URL, "/rest/v1"); return True
        if self.path.startswith("/rest/"):
            self._forward(SUPABASE_REST_URL, "/rest"); return True
        return False

    def _forward(self, upstream: str, prefix: str) -> None:
        target_path = self.path[len(prefix):] or "/"
        target = urljoin(f"{upstream}/", target_path.lstrip("/"))
        body = None
        if self.command not in {"GET", "HEAD", "OPTIONS"}:
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(length) if length else None
        if (
            upstream == SUPABASE_AUTH_URL
            and self.command == "POST"
            and target_path.startswith("/token")
            and "grant_type=password" in target_path
        ):
            try:
                payload = json.loads(body.decode() if body else "{}")
                email = (payload.get("email") or "").strip()
                if email:
                    self._assert_login_enabled(email)
            except PermissionError as error:
                self._json_error(403, str(error)); return
        headers = {
            key: value for key, value in self.headers.items()
            if key.lower() not in HOP_BY_HOP_HEADERS and key.lower() != "host"
        }
        request = urllib.request.Request(target, data=body, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
                self.send_response(response.status)
                self._copy_response_headers(response.headers)
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(payload)
        except urllib.error.HTTPError as error:
            payload = error.read()
            self.send_response(error.code)
            self._copy_response_headers(error.headers)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)
        except Exception:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"message":"Supabase upstream unavailable"}')

    def _copy_response_headers(self, headers) -> None:
        for key, value in headers.items():
            if key.lower() not in HOP_BY_HOP_HEADERS:
                self.send_header(key, value)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 80), SpaHandler).serve_forever()
