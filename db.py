"""V0.11: PostgreSQL connection pool + JWT utilities"""
import os
import hashlib
import hmac
import json
import base64
import time
from contextlib import contextmanager
from typing import Any

import psycopg2
import psycopg2.pool

_pool: psycopg2.pool.ThreadedConnectionPool | None = None

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://psa_admin@127.0.0.1:5433/psa",
)
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me")
POOL_MIN = int(os.environ.get("DB_POOL_MIN", "2"))
POOL_MAX = int(os.environ.get("DB_POOL_MAX", "8"))


def get_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global _pool
    if _pool is None:
        _pool = psycopg2.pool.ThreadedConnectionPool(POOL_MIN, POOL_MAX, DATABASE_URL)
    return _pool


@contextmanager
def get_conn():
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
    finally:
        pool.putconn(conn)


def dict_rows(cursor: Any) -> list[dict]:
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


# ---- JWT Utilities (Supabase-compatible HS256) ----

def decode_jwt(token: str) -> dict | None:
    """Decode and verify a Supabase HS256 JWT. Returns claims dict or None."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts

        # Verify signature
        expected_sig = hmac.new(
            JWT_SECRET.encode(),
            f"{header_b64}.{payload_b64}".encode(),
            hashlib.sha256,
        ).digest()
        actual_sig = base64.urlsafe_b64decode(sig_b64 + "==")
        if not hmac.compare_digest(expected_sig, actual_sig):
            return None

        # Decode payload
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=="))

        # Check expiration
        if payload.get("exp", 0) < time.time():
            return None

        return payload
    except Exception:
        return None


def get_user_id_from_jwt(token: str) -> str | None:
    """Extract sub (user UUID) from a valid JWT."""
    claims = decode_jwt(token)
    if claims:
        return claims.get("sub")
    return None


def get_user_role_from_jwt(token: str) -> str | None:
    """Extract role from a valid JWT."""
    claims = decode_jwt(token)
    if claims:
        return claims.get("role")
    return None
