"""Internal admin service — creates GoTrue users via Admin API."""
import json, hashlib, hmac, base64, time, os, sys
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request as _request, urllib.error as _error

GOTRUE_URL = os.environ.get("GOTRUE_URL", "http://127.0.0.1:8777")
JWT_SECRET = os.environ["JWT_SECRET"]
PORT = int(os.environ.get("AUTH_SERVICE_PORT", "8781"))
BIND = os.environ.get("AUTH_SERVICE_BIND", "127.0.0.1")

def make_service_token():
    header = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    payload = base64.urlsafe_b64encode(json.dumps({
        "role":"service_role","iss":"supabase",
        "iat":int(time.time()),"exp":int(time.time())+30
    }).encode()).rstrip(b'=').decode()
    sig = base64.urlsafe_b64encode(hmac.new(
        JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256
    ).digest()).rstrip(b'=').decode()
    return f"{header}.{payload}.{sig}"

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/create-user":
            self.send_error(404); return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        email = body["email"]
        password = body["password"]
        login_name = body.get("login_name", "")

        token = make_service_token()
        req_body = json.dumps({
            "email": email, "password": password,
            "email_confirm": True,
            "user_metadata": {"login_name": login_name}
        }).encode()

        req = _request.Request(
            f"{GOTRUE_URL}/admin/users", data=req_body,
            headers={"Content-Type":"application/json", "Authorization": f"Bearer {token}"}
        )
        try:
            resp = _request.urlopen(req, timeout=10)
            data = json.loads(resp.read())
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "auth_user_id": data["id"]}).encode())
        except _error.HTTPError as e:
            err = e.read().decode()[:200]
            self.send_response(e.code)
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "message": err}).encode())

    def log_message(self, *args): pass  # silent

if __name__ == "__main__":
    print(f"Auth service on {BIND}:{PORT}")
    HTTPServer((BIND, PORT), Handler).serve_forever()
