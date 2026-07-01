import base64
import hashlib
import json
import os
import unittest


os.environ.setdefault("DEFAULT_INITIAL_PASSWORD", "unit-test-password")
os.environ.setdefault("JWT_SECRET", "unit-test-jwt-secret")
os.environ["NAS_SYNC_TOKEN_SHA256"] = hashlib.sha256(b"unit-token").hexdigest()

import serve_spa  # noqa: E402


def decode_jwt_payload(token: str) -> dict:
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload.encode()).decode())


class NasSyncApiContractTest(unittest.TestCase):
    def setUp(self) -> None:
        serve_spa.NAS_SYNC_TOKEN_SHA256 = hashlib.sha256(b"unit-token").hexdigest()
        serve_spa.JWT_SECRET = "unit-test-jwt-secret"
        self.handler = serve_spa.SpaHandler.__new__(serve_spa.SpaHandler)

    def test_authorizes_only_matching_bearer_token(self) -> None:
        self.assertTrue(self.handler._nas_sync_authorized("Bearer unit-token"))
        self.assertFalse(self.handler._nas_sync_authorized(""))
        self.assertFalse(self.handler._nas_sync_authorized("Bearer wrong-token"))
        self.assertFalse(self.handler._nas_sync_authorized("Basic unit-token"))

    def test_identifies_only_nas_sync_api_paths(self) -> None:
        self.assertTrue(self.handler._is_nas_sync_path("/api/nas-sync"))
        self.assertTrue(self.handler._is_nas_sync_path("/api/nas-sync/events/pending?limit=1"))
        self.assertFalse(self.handler._is_nas_sync_path("/api/nas-syncx/events/pending"))

    def test_pending_event_payload_uses_safe_public_field_names(self) -> None:
        payload = self.handler._nas_sync_public_event({
            "id": "event-1",
            "employee_id": 42,
            "employee_name": "测试员工",
            "event_type": "employee.created",
            "status": "pending",
            "attempts": 2,
            "created_at": "2026-07-01T10:00:00Z",
            "phone": "13800000000",
            "id_card": "secret",
            "monthly_salary": "999999",
            "auth_email": "secret@example.com",
        })

        self.assertEqual(
            set(payload),
            {"eventId", "employeeId", "name", "type", "status", "attempts", "createdAt"},
        )
        self.assertEqual(payload["eventId"], "event-1")
        self.assertEqual(payload["employeeId"], 42)
        self.assertEqual(payload["name"], "测试员工")
        self.assertNotIn("phone", payload)
        self.assertNotIn("monthly_salary", payload)
        self.assertNotIn("auth_email", payload)

    def test_realtime_token_is_short_lived_nas_sync_jwt(self) -> None:
        token = self.handler._make_nas_sync_realtime_token(now=100, ttl=300)
        payload = decode_jwt_payload(token)

        self.assertEqual(payload["role"], "authenticated")
        self.assertEqual(payload["aud"], "authenticated")
        self.assertEqual(payload["sub"], "00000000-0000-0000-0000-000000000000")
        self.assertTrue(payload["nas_sync"])
        self.assertEqual(payload["iat"], 100)
        self.assertEqual(payload["exp"], 400)


if __name__ == "__main__":
    unittest.main()
