import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import app.storage as storage
from app.schemas import Announcement


class AnnouncementEngineeringFilterTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        data_dir = Path(self._tmp.name)
        self._old_data_dir = storage.DATA_DIR
        self._old_db_path = storage.DB_PATH
        storage.DATA_DIR = data_dir
        storage.DB_PATH = data_dir / "probe_history.sqlite3"
        storage.init_db()

    def tearDown(self) -> None:
        storage.DATA_DIR = self._old_data_dir
        storage.DB_PATH = self._old_db_path
        self._tmp.cleanup()

    def _save_beijing_announcement(self) -> int:
        inserted, _ = storage.save_announcements([
            Announcement(
                source_name="北京市公共资源交易服务平台",
                source_key="beijing_gcjs_zbgg",
                title="某片区全过程咨询服务招标公告",
                url="https://example.test/beijing/1",
                publish_time=datetime.now().strftime("%Y-%m-%d"),
                detail_fetched=True,
                detail_content="本项目招标范围包括全过程咨询、项目管理和造价咨询。",
                first_seen_at=datetime.now(),
            )
        ])
        self.assertEqual(len(inserted), 1)
        return inserted[0].id or 0

    def test_engineering_filter_uses_agent_tags_when_source_field_is_empty(self) -> None:
        ann_id = self._save_beijing_announcement()
        storage.save_agent_result(
            ann_id=ann_id,
            score=5,
            summary="直接契合全过程咨询和项目管理。",
            tags="全过程咨询,项目管理",
            action="重点跟进",
            stage="llm",
            confidence=0.9,
        )

        items = storage.list_announcements(engineering="咨询")
        total = storage.count_announcements(engineering="咨询")

        self.assertEqual(total, 1)
        self.assertEqual([item.id for item in items], [ann_id])

    def test_agent_result_can_backfill_empty_engineering_type(self) -> None:
        ann_id = self._save_beijing_announcement()
        storage.save_agent_result(
            ann_id=ann_id,
            score=5,
            summary="直接契合全过程咨询和项目管理。",
            tags="全过程咨询,项目管理",
            action="重点跟进",
            stage="llm",
            confidence=0.9,
            engineering_type="咨询",
        )

        item = storage.get_announcement_by_id(ann_id)

        self.assertIsNotNone(item)
        self.assertEqual(item.engineering_type, "咨询")


if __name__ == "__main__":
    unittest.main()
