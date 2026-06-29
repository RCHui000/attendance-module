import hashlib
import importlib
import os
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class NasSyncApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ.setdefault("DEFAULT_INITIAL_PASSWORD", "test-password")
        os.environ["NAS_SYNC_TOKEN_SHA256"] = hashlib.sha256(b"secret-token").hexdigest()
        cls.serve_spa = importlib.import_module("serve_spa")

    def test_validates_dedicated_sync_token_by_hash(self):
        self.assertTrue(self.serve_spa.nas_sync_token_valid("Bearer secret-token"))
        self.assertFalse(self.serve_spa.nas_sync_token_valid("Bearer wrong-token"))
        self.assertFalse(self.serve_spa.nas_sync_token_valid(""))

    def test_extracts_nas_sync_event_action_from_path(self):
        event_id, action = self.serve_spa.parse_nas_sync_event_path(
            "/api/nas-sync/events/018f7a97-8a8f-7d52-a94d-b4f52ce76e40/claim"
        )
        self.assertEqual(event_id, "018f7a97-8a8f-7d52-a94d-b4f52ce76e40")
        self.assertEqual(action, "claim")
        self.assertIsNone(self.serve_spa.parse_nas_sync_event_path("/api/nas-sync/events/nope/claim"))

    def test_public_event_payload_exposes_only_required_fields(self):
        payload = self.serve_spa.nas_sync_public_event(
            {
                "id": "event-1",
                "employee_id": 42,
                "employee_name": "张三",
                "event_type": "employee.created",
                "status": "pending",
                "attempts": 0,
                "created_at": "2026-06-29T00:00:00Z",
                "monthly_salary": 99999,
                "claim_token": "secret",
            }
        )
        self.assertEqual(
            sorted(payload.keys()),
            ["attempts", "createdAt", "employeeId", "eventId", "name", "status", "type"],
        )
        self.assertEqual(payload["name"], "张三")
        self.assertNotIn("monthly_salary", payload)
        self.assertNotIn("claim_token", payload)


if __name__ == "__main__":
    unittest.main()
