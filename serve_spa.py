import os
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urljoin


ROOT = Path("/app")
SUPABASE_AUTH_URL = os.environ.get("SUPABASE_AUTH_URL", "http://192.168.2.100:8777").rstrip("/")
SUPABASE_REST_URL = os.environ.get("SUPABASE_REST_URL", "http://192.168.2.100:8779").rstrip("/")
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


class SpaHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if self._proxy_supabase():
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if self._proxy_supabase():
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        if self._proxy_supabase():
            return
        self.send_error(404)

    def do_PATCH(self) -> None:
        if self._proxy_supabase():
            return
        self.send_error(404)

    def do_DELETE(self) -> None:
        if self._proxy_supabase():
            return
        self.send_error(404)

    def do_OPTIONS(self) -> None:
        if self._proxy_supabase():
            return
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, OPTIONS")
        self.end_headers()

    def end_headers(self) -> None:
        if self.path == "/" or self.path.endswith(".html"):
            self.send_header("Cache-Control", "no-store")
        elif self.path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        translated = Path(super().translate_path(path))
        if translated.exists():
            return str(translated)
        return str(ROOT / "index.html")

    def _proxy_supabase(self) -> bool:
        if self.path.startswith("/auth/"):
            self._forward(SUPABASE_AUTH_URL, "/auth")
            return True
        if self.path.startswith("/rest/"):
            self._forward(SUPABASE_REST_URL, "/rest")
            return True
        return False

    def _forward(self, upstream: str, prefix: str) -> None:
        target_path = self.path[len(prefix):] or "/"
        target = urljoin(f"{upstream}/", target_path.lstrip("/"))
        body = None
        if self.command not in {"GET", "HEAD", "OPTIONS"}:
            length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(length) if length else None

        headers = {
            key: value
            for key, value in self.headers.items()
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
