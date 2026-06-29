from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase-psa" / "migrations" / "126_nas_sync_events.sql"


class NasSyncMigrationStaticTests(unittest.TestCase):
    def test_migration_declares_secure_event_queue_contract(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        required_fragments = [
            "CREATE TABLE IF NOT EXISTS public.nas_sync_events",
            "employee_id BIGINT NOT NULL REFERENCES public.employees(id)",
            "claim_token TEXT",
            "CREATE UNIQUE INDEX IF NOT EXISTS nas_sync_events_employee_created_once",
            "CREATE OR REPLACE FUNCTION public.psa_enqueue_nas_sync_employee_created()",
            "AFTER INSERT ON public.employees",
            "ALTER PUBLICATION supabase_realtime ADD TABLE public.nas_sync_events",
            "CREATE ROLE nas_sync",
            "ALTER TABLE public.nas_sync_events ENABLE ROW LEVEL SECURITY",
            "CREATE POLICY nas_sync_read_events",
            "REVOKE ALL ON public.nas_sync_events FROM PUBLIC, anon, authenticated",
        ]
        for fragment in required_fragments:
            self.assertIn(fragment, sql)


if __name__ == "__main__":
    unittest.main()
