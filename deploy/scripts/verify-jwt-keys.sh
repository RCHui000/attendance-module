#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/approval-app/env/production.env}"
PYTHON_BIN="${PYTHON_BIN:-}"

if [ -z "${PYTHON_BIN}" ]; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
  else
    echo "Missing python3/python; cannot verify JWT keys." >&2
    exit 1
  fi
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing environment file: ${ENV_FILE}" >&2
  exit 1
fi

ENV_FILE="${ENV_FILE}" "${PYTHON_BIN}" - <<'PY'
import base64
import hashlib
import hmac
import json
import os
import re
import shlex
import sys


ENV_FILE = os.environ["ENV_FILE"]
EXPECTED_ROLES = {
    "ANON_KEY": "anon",
    "VITE_SUPABASE_ANON_KEY": "anon",
    "SERVICE_ROLE_KEY": "service_role",
}


def parse_env_file(path):
    values = {}
    with open(path, "r", encoding="utf-8-sig") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
                continue
            value = value.strip().rstrip("\r")
            if value:
                try:
                    if value[0] in {"'", '"'}:
                        parsed = shlex.split(value, comments=False, posix=True)
                        value = parsed[0] if parsed else ""
                    else:
                        value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
                except ValueError as exc:
                    raise ValueError(f"Cannot parse {key} in {path}: {exc}") from exc
            values[key] = value
    return values


def b64url_decode(part, label):
    try:
        return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
    except Exception as exc:
        raise ValueError(f"{label} is not valid base64url") from exc


def load_json(part, label):
    try:
        return json.loads(b64url_decode(part, label).decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} is not valid JSON") from exc
    except UnicodeDecodeError as exc:
        raise ValueError(f"{label} is not valid UTF-8") from exc


def verify_jwt(name, token, secret, expected_role):
    parts = token.split(".")
    if len(parts) != 3 or not all(parts):
        raise ValueError(f"{name} is not a three-part JWT")

    header = load_json(parts[0], f"{name} header")
    payload = load_json(parts[1], f"{name} payload")

    if header.get("alg") != "HS256":
        raise ValueError(f"{name} alg is {header.get('alg')!r}, expected 'HS256'")
    if payload.get("role") != expected_role:
        raise ValueError(f"{name} role is {payload.get('role')!r}, expected {expected_role!r}")

    signing_input = f"{parts[0]}.{parts[1]}".encode("ascii")
    expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    actual_sig = b64url_decode(parts[2], f"{name} signature")
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise ValueError(f"{name} signature does not match JWT_SECRET")

    return {
        "alg": header.get("alg"),
        "role": payload.get("role"),
        "aud": payload.get("aud", ""),
        "iss": payload.get("iss", ""),
    }


def main():
    try:
        env = parse_env_file(ENV_FILE)
    except Exception as exc:
        print(f"JWT key verification failed: {exc}", file=sys.stderr)
        return 1

    errors = []
    jwt_secret = (env.get("JWT_SECRET") or "").strip()
    if not jwt_secret:
        errors.append("JWT_SECRET is missing or empty")

    summaries = {}
    if jwt_secret:
        for name, expected_role in EXPECTED_ROLES.items():
            token = (env.get(name) or "").strip()
            if not token:
                errors.append(f"{name} is missing or empty")
                continue
            try:
                summaries[name] = verify_jwt(name, token, jwt_secret, expected_role)
            except Exception as exc:
                errors.append(str(exc))

    if errors:
        print("JWT key verification failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    role_summary = ", ".join(f"{name}={summary['role']}" for name, summary in summaries.items())
    print(f"JWT key verification OK: {len(summaries)} HS256 keys match JWT_SECRET ({role_summary}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
PY
