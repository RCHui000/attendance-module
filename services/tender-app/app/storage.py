import json
import sqlite3
from datetime import datetime
from typing import Any

from app.config import DATA_DIR, DB_PATH
from app.schemas import (
    AgentSettings,
    AgentSettingsPublic,
    Announcement,
    BillingRun,
    BillingSummary,
    CrawlScheduleSettings,
    ProbeResult,
    ProbeSignal,
    ScheduleTask,
    SourceCrawlRun,
    SourceConfig,
    SourceState,
)

# Columns added in v2 migration
_V2_COLUMNS = [
    ("project_name", "TEXT NOT NULL DEFAULT ''"),
    ("bid_section_name", "TEXT NOT NULL DEFAULT ''"),
    ("tenderer", "TEXT NOT NULL DEFAULT ''"),
    ("bid_deadline", "TEXT NOT NULL DEFAULT ''"),
    ("engineering_type", "TEXT NOT NULL DEFAULT ''"),
    ("bid_method", "TEXT NOT NULL DEFAULT ''"),
    ("detail_content", "TEXT NOT NULL DEFAULT ''"),
    ("detail_fetched", "INTEGER NOT NULL DEFAULT 0"),
]

# Columns added in v3 migration (agent analysis)
_V3_COLUMNS = [
    ("opportunity_score", "INTEGER NOT NULL DEFAULT 0"),
    ("agent_summary", "TEXT NOT NULL DEFAULT ''"),
    ("agent_tags", "TEXT NOT NULL DEFAULT ''"),
    ("agent_action", "TEXT NOT NULL DEFAULT ''"),
    ("agent_analyzed", "INTEGER NOT NULL DEFAULT 0"),
]

# Columns added in v4 migration (two-stage agent)
_V4_COLUMNS = [
    ("agent_stage", "TEXT NOT NULL DEFAULT 'none'"),
    ("agent_confidence", "REAL NOT NULL DEFAULT 0"),
    ("agent_error", "TEXT NOT NULL DEFAULT ''"),
    ("agent_updated_at", "TEXT NOT NULL DEFAULT ''"),
]

ANNOUNCEMENT_RETENTION_DAYS = 30


def _migrate_v2(conn: sqlite3.Connection) -> None:
    """Add v2 columns if they don't exist."""
    existing = {
        row[1]
        for row in conn.execute("PRAGMA table_info(announcements)").fetchall()
    }
    for col_name, col_def in _V2_COLUMNS:
        if col_name not in existing:
            conn.execute(f"ALTER TABLE announcements ADD COLUMN {col_name} {col_def}")


def migrate(conn: sqlite3.Connection, columns: list[tuple[str, str]]) -> None:
    existing = {row[1] for row in conn.execute("PRAGMA table_info(announcements)").fetchall()}
    for col_name, col_def in columns:
        if col_name not in existing:
            conn.execute(f"ALTER TABLE announcements ADD COLUMN {col_name} {col_def}")


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS probe_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_name TEXT NOT NULL,
                url TEXT NOT NULL,
                level TEXT NOT NULL,
                score INTEGER NOT NULL,
                summary TEXT NOT NULL,
                recommendation TEXT NOT NULL,
                signals_json TEXT NOT NULL,
                metrics_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_name TEXT NOT NULL,
                source_key TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                publish_time TEXT NOT NULL,
                notice_type TEXT NOT NULL,
                notice_sub_type TEXT NOT NULL,
                region TEXT NOT NULL,
                project_code TEXT NOT NULL,
                raw_json TEXT NOT NULL,
                first_seen_at TEXT NOT NULL,
                UNIQUE(source_key, url, title, publish_time)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS source_states (
                source_key TEXT PRIMARY KEY,
                source_name TEXT NOT NULL,
                consecutive_failures INTEGER NOT NULL DEFAULT 0,
                is_paused INTEGER NOT NULL DEFAULT 0,
                last_error TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS source_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_key TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                list_url TEXT NOT NULL,
                source_type TEXT NOT NULL DEFAULT 'shenzhen',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS billing_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_type TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                start_balance REAL,
                end_balance REAL,
                cost REAL,
                currency TEXT NOT NULL DEFAULT '',
                provider TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                error TEXT NOT NULL DEFAULT ''
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS source_crawl_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_key TEXT NOT NULL,
                source_name TEXT NOT NULL,
                crawl_date TEXT NOT NULL,
                target_start_time TEXT NOT NULL,
                target_end_time TEXT NOT NULL,
                expected_total_count INTEGER,
                expected_total_pages INTEGER,
                fetched_pages_json TEXT NOT NULL,
                fetched_count INTEGER NOT NULL DEFAULT 0,
                first_publish_time TEXT NOT NULL DEFAULT '',
                last_publish_time TEXT NOT NULL DEFAULT '',
                reached_date_boundary INTEGER NOT NULL DEFAULT 0,
                hit_page_cap INTEGER NOT NULL DEFAULT 0,
                error_pages_json TEXT NOT NULL,
                completeness_status TEXT NOT NULL DEFAULT 'unknown',
                started_at TEXT NOT NULL,
                finished_at TEXT NOT NULL,
                message TEXT NOT NULL DEFAULT ''
            )
            """
        )
        _migrate_v2(conn)
        migrate(conn, _V3_COLUMNS)
        migrate(conn, _V4_COLUMNS)
        _seed_default_sources(conn)
        _prune_old_announcements(conn, ANNOUNCEMENT_RETENTION_DAYS)
        conn.commit()


def _seed_default_sources(conn: sqlite3.Connection) -> None:
    now = datetime.now().isoformat()
    defaults = [
        ("shenzhen_jsgc_zbgg", "深圳公共资源交易中心",
         "https://www.szggzy.com/jygg/list.html?id=jsgc", "shenzhen"),
        ("beijing_gcjs_zbgg", "北京市公共资源交易服务平台",
         "https://ggzyfw.beijing.gov.cn/jyxxggjtbyqs/index.html", "beijing"),
    ]
    for key, name, url, stype in defaults:
        conn.execute(
            "INSERT OR IGNORE INTO source_configs (source_key, name, list_url, source_type, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)",
            (key, name, url, stype, now),
        )


def _prune_old_announcements(conn: sqlite3.Connection, days: int) -> int:
    cutoff = f"-{days} days"
    cursor = conn.execute(
        """
        DELETE FROM announcements
        WHERE
            (
                publish_time != ''
                AND date(substr(publish_time, 1, 10)) < date('now', ?)
            )
            OR (
                publish_time = ''
                AND datetime(first_seen_at) < datetime('now', ?)
            )
            OR datetime(first_seen_at) < datetime('now', ?)
        """,
        (cutoff, cutoff, cutoff),
    )
    return cursor.rowcount


def prune_old_announcements(days: int = ANNOUNCEMENT_RETENTION_DAYS) -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        deleted = _prune_old_announcements(conn, days)
        conn.commit()
        return deleted


# ─── Source Config CRUD ────────────────────────────────

def list_source_configs() -> list[SourceConfig]:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM source_configs ORDER BY id").fetchall()
    return [
        SourceConfig(
            id=r["id"], source_key=r["source_key"], name=r["name"],
            list_url=r["list_url"], source_type=r["source_type"],
            enabled=bool(r["enabled"]),
            created_at=datetime.fromisoformat(r["created_at"]),
        )
        for r in rows
    ]


def get_source_config(source_key: str) -> SourceConfig | None:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM source_configs WHERE source_key = ?", (source_key,)).fetchone()
    if not row:
        return None
    return SourceConfig(
        id=row["id"], source_key=row["source_key"], name=row["name"],
        list_url=row["list_url"], source_type=row["source_type"],
        enabled=bool(row["enabled"]),
        created_at=datetime.fromisoformat(row["created_at"]),
    )


def upsert_source_config(cfg: SourceConfig) -> SourceConfig:
    init_db()
    now = datetime.now().isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """INSERT INTO source_configs (source_key, name, list_url, source_type, enabled, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(source_key) DO UPDATE SET
               name=excluded.name, list_url=excluded.list_url,
               source_type=excluded.source_type, enabled=excluded.enabled""",
            (cfg.source_key, cfg.name, cfg.list_url, cfg.source_type, 1 if cfg.enabled else 0, now),
        )
        conn.commit()
    return get_source_config(cfg.source_key) or cfg


def delete_source_config(source_key: str) -> bool:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM source_configs WHERE source_key = ?", (source_key,))
        conn.commit()
        return cursor.rowcount > 0


def _mask_api_key(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 10:
        return api_key[:2] + "***"
    return f"{api_key[:6]}...{api_key[-4:]}"


def get_agent_settings() -> AgentSettings:
    init_db()
    defaults = AgentSettings()
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT key, value FROM app_settings WHERE key IN ('agent_api_key', 'agent_api_base', 'agent_model', 'agent_enabled')"
        ).fetchall()
    values = {key: value for key, value in rows}
    api_key = values.get("agent_api_key", "")
    enabled_raw = values.get("agent_enabled")
    enabled = bool(api_key) if enabled_raw is None else (enabled_raw == "1" and bool(api_key))
    return AgentSettings(
        api_key=api_key,
        api_base=values.get("agent_api_base", defaults.api_base),
        model=values.get("agent_model", defaults.model),
        enabled=enabled,
    )


def get_agent_settings_public() -> AgentSettingsPublic:
    settings = get_agent_settings()
    return AgentSettingsPublic(
        api_base=settings.api_base,
        model=settings.model,
        api_key_masked=_mask_api_key(settings.api_key),
        enabled=settings.enabled,
    )


def save_agent_settings(settings: AgentSettings) -> AgentSettingsPublic:
    init_db()
    now = datetime.now().isoformat()
    current = get_agent_settings()
    api_key = settings.api_key.strip()
    if api_key == "__CLEAR__":
        api_key = ""
    elif not api_key or api_key == "__KEEP__":
        api_key = current.api_key
    values = {
        "agent_api_key": api_key,
        "agent_api_base": settings.api_base.strip() or current.api_base,
        "agent_model": settings.model.strip() or current.model,
        "agent_enabled": "1" if settings.enabled else "0",
    }
    with sqlite3.connect(DB_PATH) as conn:
        for key, value in values.items():
            conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (key, value, now),
            )
        conn.commit()
    return get_agent_settings_public()


def get_crawl_schedule_settings() -> CrawlScheduleSettings:
    init_db()
    defaults = CrawlScheduleSettings()
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            """
            SELECT key, value FROM app_settings
            WHERE key IN (
                'crawl_schedule_enabled',
                'crawl_schedule_hour',
                'crawl_schedule_minute',
                'crawl_schedule_lookback_days',
                'crawl_schedule_action',
                'crawl_schedule_tasks'
            )
            """
        ).fetchall()
    values = {key: value for key, value in rows}

    def _int_value(key: str, default: int, low: int, high: int) -> int:
        try:
            return max(low, min(high, int(values.get(key, default))))
        except (TypeError, ValueError):
            return default

    legacy_task = ScheduleTask(
        id="default-crawl",
        sort_order=0,
        enabled=values.get("crawl_schedule_enabled", "1") == "1",
        action="crawl_sources",
        hour=_int_value("crawl_schedule_hour", defaults.hour, 0, 23),
        minute=_int_value("crawl_schedule_minute", defaults.minute, 0, 59),
        lookback_days=_int_value("crawl_schedule_lookback_days", defaults.lookback_days, 1, 30),
    )
    tasks: list[ScheduleTask] = []
    raw_tasks = values.get("crawl_schedule_tasks", "")
    if raw_tasks:
        try:
            loaded = json.loads(raw_tasks)
            if isinstance(loaded, list):
                for index, item in enumerate(loaded):
                    if isinstance(item, dict):
                        task = ScheduleTask(**item)
                        tasks.append(task.model_copy(update={"id": task.id or f"task-{index + 1}", "sort_order": index}))
        except (TypeError, ValueError):
            tasks = []
    if not tasks:
        tasks = [legacy_task]
    tasks = sorted(tasks, key=lambda task: (task.sort_order, task.id))

    first_crawl = next((task for task in tasks if task.action == "crawl_sources"), tasks[0])
    return CrawlScheduleSettings(
        enabled=values.get("crawl_schedule_enabled", "1") == "1",
        hour=first_crawl.hour,
        minute=first_crawl.minute,
        lookback_days=first_crawl.lookback_days,
        action=first_crawl.action,
        tasks=tasks,
    )


def save_crawl_schedule_settings(settings: CrawlScheduleSettings) -> CrawlScheduleSettings:
    init_db()
    now = datetime.now().isoformat()
    tasks = settings.tasks or [
        ScheduleTask(
            id="default-crawl",
            sort_order=0,
            enabled=settings.enabled,
            action="crawl_sources",
            hour=settings.hour,
            minute=settings.minute,
            lookback_days=settings.lookback_days,
        )
    ]
    normalized_tasks = [
        task.model_copy(update={"id": task.id or f"task-{index + 1}", "sort_order": index})
        for index, task in enumerate(tasks)
    ]
    first_crawl = next((task for task in normalized_tasks if task.action == "crawl_sources"), normalized_tasks[0])
    values = {
        "crawl_schedule_enabled": "1" if settings.enabled else "0",
        "crawl_schedule_hour": str(first_crawl.hour),
        "crawl_schedule_minute": str(first_crawl.minute),
        "crawl_schedule_lookback_days": str(first_crawl.lookback_days),
        "crawl_schedule_action": first_crawl.action or "crawl_sources",
        "crawl_schedule_tasks": json.dumps(
            [task.model_dump(mode="json") for task in normalized_tasks],
            ensure_ascii=False,
        ),
    }
    with sqlite3.connect(DB_PATH) as conn:
        for key, value in values.items():
            conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (key, value, now),
            )
        conn.commit()
    return get_crawl_schedule_settings()


def create_billing_run(
    job_type: str,
    start_balance: float | None,
    currency: str = "",
    provider: str = "",
    error: str = "",
) -> BillingRun:
    init_db()
    started_at = datetime.now()
    status = "running" if not error else "balance_unavailable"
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            INSERT INTO billing_runs (
                job_type, started_at, start_balance, currency, provider, status, error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (job_type, started_at.isoformat(timespec="seconds"), start_balance, currency, provider, status, error[:500]),
        )
        conn.commit()
        run_id = cursor.lastrowid
    return BillingRun(
        id=run_id,
        job_type=job_type,
        started_at=started_at,
        start_balance=start_balance,
        currency=currency,
        provider=provider,
        status=status,
        error=error[:500],
    )


def finish_billing_run(
    run_id: int | None,
    end_balance: float | None,
    currency: str = "",
    provider: str = "",
    status: str = "finished",
    error: str = "",
) -> BillingRun | None:
    if not run_id:
        return None
    init_db()
    finished_at = datetime.now()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM billing_runs WHERE id = ?", (run_id,)).fetchone()
        if not row:
            return None
        start_balance = row["start_balance"]
        cost = None
        if start_balance is not None and end_balance is not None:
            cost = max(0.0, round(float(start_balance) - float(end_balance), 6))
        final_currency = currency or row["currency"] or ""
        final_provider = provider or row["provider"] or ""
        existing_error = row["error"] or ""
        final_error = _join_unique_errors(existing_error, error[:500])
        final_status = status
        if status == "finished" and start_balance is None and end_balance is None:
            final_status = "balance_unavailable"
        elif status == "finished" and end_balance is None:
            final_status = "balance_end_failed"
        elif status == "finished" and start_balance is None:
            final_status = "balance_start_failed"
        conn.execute(
            """
            UPDATE billing_runs
            SET finished_at = ?,
                end_balance = ?,
                cost = ?,
                currency = ?,
                provider = ?,
                status = ?,
                error = ?
            WHERE id = ?
            """,
            (
                finished_at.isoformat(timespec="seconds"),
                end_balance,
                cost,
                final_currency,
                final_provider,
                final_status,
                final_error,
                run_id,
            ),
        )
        conn.commit()
    return get_billing_run(run_id)


def get_billing_run(run_id: int) -> BillingRun | None:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM billing_runs WHERE id = ?", (run_id,)).fetchone()
    return _row_to_billing_run(row) if row else None


def list_billing_runs(limit: int = 50) -> list[BillingRun]:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM billing_runs ORDER BY datetime(started_at) DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_row_to_billing_run(row) for row in rows]


def get_billing_summary(limit: int = 50) -> BillingSummary:
    runs = list_billing_runs(limit)
    priced_runs = [run for run in runs if run.cost is not None]
    failed_runs = [run for run in runs if run.cost is None and run.status != "running"]
    total = round(sum(run.cost or 0.0 for run in priced_runs), 6)
    currency = next((run.currency for run in priced_runs if run.currency), next((run.currency for run in runs if run.currency), ""))
    return BillingSummary(
        total_cost=total,
        run_count=len(runs),
        priced_run_count=len(priced_runs),
        failed_run_count=len(failed_runs),
        currency=currency,
        last_run=runs[0] if runs else None,
    )


def _join_unique_errors(*parts: str) -> str:
    unique: list[str] = []
    seen: set[str] = set()
    for part in parts:
        for item in part.split(";"):
            message = item.strip()
            if message and message not in seen:
                seen.add(message)
                unique.append(message)
    return "; ".join(unique)[:500]


def save_source_crawl_run(run: SourceCrawlRun) -> SourceCrawlRun:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            INSERT INTO source_crawl_runs (
                source_key, source_name, crawl_date, target_start_time, target_end_time,
                expected_total_count, expected_total_pages, fetched_pages_json,
                fetched_count, first_publish_time, last_publish_time,
                reached_date_boundary, hit_page_cap, error_pages_json,
                completeness_status, started_at, finished_at, message
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run.source_key,
                run.source_name,
                run.crawl_date,
                run.target_start_time,
                run.target_end_time,
                run.expected_total_count,
                run.expected_total_pages,
                json.dumps(run.fetched_pages, ensure_ascii=False),
                run.fetched_count,
                run.first_publish_time,
                run.last_publish_time,
                1 if run.reached_date_boundary else 0,
                1 if run.hit_page_cap else 0,
                json.dumps(run.error_pages, ensure_ascii=False),
                run.completeness_status,
                run.started_at.isoformat(timespec="seconds"),
                run.finished_at.isoformat(timespec="seconds"),
                run.message[:1000],
            ),
        )
        conn.commit()
        run_id = cursor.lastrowid
    return run.model_copy(update={"id": run_id})


def list_source_crawl_runs(limit: int = 20, crawl_date: str = "") -> list[SourceCrawlRun]:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        params: list[Any] = []
        where = ""
        if crawl_date:
            where = "WHERE crawl_date = ?"
            params.append(crawl_date)
        params.append(limit)
        rows = conn.execute(
            f"""
            SELECT * FROM source_crawl_runs
            {where}
            ORDER BY datetime(started_at) DESC, id DESC
            LIMIT ?
            """,
            params,
        ).fetchall()
    return [_row_to_source_crawl_run(row) for row in rows]


def latest_source_crawl_runs(crawl_date: str = "") -> list[SourceCrawlRun]:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        params: list[Any] = []
        date_filter = ""
        if crawl_date:
            date_filter = "WHERE crawl_date = ?"
            params.append(crawl_date)
        rows = conn.execute(
            f"""
            SELECT r.*
            FROM source_crawl_runs r
            JOIN (
                SELECT source_key, MAX(id) AS max_id
                FROM source_crawl_runs
                {date_filter}
                GROUP BY source_key
            ) latest ON latest.source_key = r.source_key AND latest.max_id = r.id
            ORDER BY r.source_name
            """,
            params,
        ).fetchall()
    return [_row_to_source_crawl_run(row) for row in rows]


def _row_to_source_crawl_run(row: sqlite3.Row) -> SourceCrawlRun:
    return SourceCrawlRun(
        id=row["id"],
        source_key=row["source_key"],
        source_name=row["source_name"],
        crawl_date=row["crawl_date"],
        target_start_time=row["target_start_time"],
        target_end_time=row["target_end_time"],
        expected_total_count=row["expected_total_count"],
        expected_total_pages=row["expected_total_pages"],
        fetched_pages=json.loads(row["fetched_pages_json"] or "[]"),
        fetched_count=row["fetched_count"],
        first_publish_time=row["first_publish_time"],
        last_publish_time=row["last_publish_time"],
        reached_date_boundary=bool(row["reached_date_boundary"]),
        hit_page_cap=bool(row["hit_page_cap"]),
        error_pages=json.loads(row["error_pages_json"] or "[]"),
        completeness_status=row["completeness_status"],
        started_at=datetime.fromisoformat(row["started_at"]),
        finished_at=datetime.fromisoformat(row["finished_at"]),
        message=row["message"],
    )


def _row_to_billing_run(row: sqlite3.Row) -> BillingRun:
    status = row["status"]
    if (
        status == "balance_end_failed"
        and row["start_balance"] is None
        and row["end_balance"] is None
    ):
        status = "balance_unavailable"
    return BillingRun(
        id=row["id"],
        job_type=row["job_type"],
        started_at=datetime.fromisoformat(row["started_at"]),
        finished_at=datetime.fromisoformat(row["finished_at"]) if row["finished_at"] else None,
        start_balance=row["start_balance"],
        end_balance=row["end_balance"],
        cost=row["cost"],
        currency=row["currency"],
        provider=row["provider"],
        status=status,
        error=_join_unique_errors(row["error"]),
    )


# ─── Existing functions ────────────────────────────────

def save_probe_result(result: ProbeResult) -> ProbeResult:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            INSERT INTO probe_runs (
                source_name, url, level, score, summary, recommendation,
                signals_json, metrics_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result.source_name,
                result.url,
                result.level,
                result.score,
                result.summary,
                result.recommendation,
                json.dumps([signal.model_dump() for signal in result.signals], ensure_ascii=False),
                json.dumps(result.metrics, ensure_ascii=False),
                result.created_at.isoformat(),
            ),
        )
        conn.commit()
        return result.model_copy(update={"id": cursor.lastrowid})


def list_probe_results(limit: int = 50) -> list[ProbeResult]:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT * FROM probe_runs
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    return [_row_to_result(row) for row in rows]


def _row_to_result(row: sqlite3.Row) -> ProbeResult:
    signals_data: list[dict[str, Any]] = json.loads(row["signals_json"])
    return ProbeResult(
        id=row["id"],
        source_name=row["source_name"],
        url=row["url"],
        level=row["level"],
        score=row["score"],
        summary=row["summary"],
        recommendation=row["recommendation"],
        signals=[ProbeSignal(**signal) for signal in signals_data],
        metrics=json.loads(row["metrics_json"]),
        created_at=datetime.fromisoformat(row["created_at"]),
    )


def save_announcements(items: list[Announcement]) -> tuple[list[Announcement], int]:
    init_db()
    inserted: list[Announcement] = []
    skipped = 0
    with sqlite3.connect(DB_PATH) as conn:
        for item in items:
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO announcements (
                    source_name, source_key, title, url, publish_time,
                    notice_type, notice_sub_type, region, project_name, project_code,
                    bid_section_name, tenderer, bid_deadline, engineering_type,
                    bid_method, detail_content, detail_fetched,
                    raw_json, first_seen_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item.source_name,
                    item.source_key,
                    item.title,
                    item.url,
                    item.publish_time,
                    item.notice_type,
                    item.notice_sub_type,
                    item.region,
                    item.project_name,
                    item.project_code,
                    item.bid_section_name,
                    item.tenderer,
                    item.bid_deadline,
                    item.engineering_type,
                    item.bid_method,
                    item.detail_content,
                    1 if item.detail_fetched else 0,
                    json.dumps(item.raw, ensure_ascii=False),
                    item.first_seen_at.isoformat(),
                ),
            )
            if cursor.rowcount:
                inserted.append(item.model_copy(update={"id": cursor.lastrowid}))
            else:
                skipped += 1
        conn.commit()
    return inserted, skipped


def update_announcement_detail(
    ann_id: int,
    detail_content: str,
    detail_attrs: dict[str, Any],
    bid_deadline: str = "",
    project_name: str = "",
    tenderer: str = "",
    engineering_type: str = "",
    bid_method: str = "",
    region: str = "",
) -> bool:
    """Update an existing announcement with detail content."""
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """
            UPDATE announcements
            SET detail_content = ?,
                detail_fetched = 1,
                bid_deadline = CASE WHEN bid_deadline = '' THEN ? ELSE bid_deadline END,
                project_name = CASE WHEN project_name = '' THEN ? ELSE project_name END,
                tenderer = CASE WHEN tenderer = '' THEN ? ELSE tenderer END,
                engineering_type = CASE WHEN engineering_type = '' THEN ? ELSE engineering_type END,
                bid_method = CASE WHEN bid_method = '' THEN ? ELSE bid_method END,
                region = CASE WHEN region = '' THEN ? ELSE region END
            WHERE id = ?
            """,
            (
                detail_content,
                bid_deadline,
                project_name,
                tenderer,
                engineering_type,
                bid_method,
                region,
                ann_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def save_agent_result(
    ann_id: int,
    score: int,
    summary: str,
    tags: str,
    action: str,
    stage: str = "llm",
    confidence: float = 0.0,
    error: str = "",
    analyzed: bool = True,
    engineering_type: str = "",
) -> bool:
    """Store agent analysis result for an announcement."""
    init_db()
    now = datetime.now().isoformat(timespec="seconds")
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            """UPDATE announcements SET
               opportunity_score=?,
               agent_summary=?,
               agent_tags=?,
               agent_action=?,
               agent_analyzed=?,
               agent_stage=?,
               agent_confidence=?,
               agent_error=?,
               agent_updated_at=?,
               engineering_type=CASE
                   WHEN engineering_type = '' AND ? != '' THEN ?
                   ELSE engineering_type
               END
               WHERE id=?""",
            (
                score,
                summary,
                tags,
                action,
                1 if analyzed else 0,
                stage,
                confidence,
                error[:500],
                now,
                engineering_type.strip(),
                engineering_type.strip(),
                ann_id,
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def _engineering_match_clause(value: str) -> tuple[str, list[Any]]:
    """Match source engineering type, with agent fields as fallback for sparse sources."""
    value = value.strip()
    if not value:
        return "", []
    like = f"%{value}%"
    return (
        "("
        "engineering_type = ? "
        "OR agent_tags LIKE ? "
        "OR agent_summary LIKE ? "
        "OR agent_action LIKE ?"
        ")",
        [value, like, like, like],
    )


def get_announcements_for_agent(limit: int | None = 20, force: bool = False) -> list[Announcement]:
    """Get announcements with detail but not yet analyzed by agent."""
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cutoff = f"-{ANNOUNCEMENT_RETENTION_DAYS} days"
        where = """
            detail_fetched = 1
            AND datetime(first_seen_at) >= datetime('now', ?)
            AND (
                publish_time = ''
                OR date(substr(publish_time, 1, 10)) IS NULL
                OR date(substr(publish_time, 1, 10)) >= date('now', ?)
            )
        """
        params: list[Any] = [cutoff, cutoff]
        if not force:
            where += " AND agent_analyzed = 0"
        limit_clause = "LIMIT ?" if limit else ""
        query_params: tuple[Any, ...] = (*params, limit) if limit else tuple(params)
        rows = conn.execute(
            f"""SELECT * FROM announcements
               WHERE {where}
               ORDER BY publish_time DESC
               {limit_clause}""",
            query_params,
        ).fetchall()
    return [_row_to_announcement(r) for r in rows]


def get_opportunities(
    limit: int = 50, days: int = 15, min_score: int = 3,
) -> list[Announcement]:
    """Get scored opportunities (值得关注)."""
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        conditions = ["agent_analyzed = 1", "opportunity_score >= ?"]
        params: list[Any] = [min_score]
        if days > 0:
            conditions.append("publish_time >= date('now', ?)")
            params.append(f"-{days} days")
        where = "WHERE " + " AND ".join(conditions)
        params.append(limit)
        rows = conn.execute(
            f"SELECT * FROM announcements {where} ORDER BY opportunity_score DESC, publish_time DESC LIMIT ?",
            params,
        ).fetchall()
    return [_row_to_announcement(r) for r in rows]


def get_recent_new(limit: int = 30) -> list[Announcement]:
    """Get recently added announcements (last 3 days, newest first)."""
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """SELECT * FROM announcements
               WHERE first_seen_at >= datetime('now', '-3 days')
               ORDER BY first_seen_at DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
    return [_row_to_announcement(r) for r in rows]


def get_announcements_without_detail(limit: int = 30) -> list[Announcement]:
    """Get announcements that haven't had detail fetched yet."""
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cutoff = f"-{ANNOUNCEMENT_RETENTION_DAYS} days"
        rows = conn.execute(
            """
            SELECT * FROM announcements
            WHERE detail_fetched = 0
              AND datetime(first_seen_at) >= datetime('now', ?)
              AND (
                  publish_time = ''
                  OR date(substr(publish_time, 1, 10)) IS NULL
                  OR date(substr(publish_time, 1, 10)) >= date('now', ?)
              )
            ORDER BY publish_time DESC, id DESC
            LIMIT ?
            """,
            (cutoff, cutoff, limit),
        ).fetchall()
    return [_row_to_announcement(row) for row in rows]


def list_announcements(
    limit: int = 100,
    offset: int = 0,
    search: str = "",
    source_key: str = "",
    days: int = 0,
    exclude_engineering: str = "",
    engineering: str = "",
    sort_by: str = "opportunity_score",
    sort_order: str = "desc",
) -> list[Announcement]:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        conditions = []
        params: list[Any] = []
        if search:
            conditions.append(
                "(title LIKE ? OR project_name LIKE ? OR tenderer LIKE ? OR bid_section_name LIKE ?)"
            )
            like = f"%{search}%"
            params.extend([like, like, like, like])
        if source_key:
            conditions.append("source_key = ?")
            params.append(source_key)
        if days > 0:
            conditions.append("publish_time >= date('now', ?)")
            params.append(f"-{days} days")
        # Exclude engineering types (comma-separated)
        if exclude_engineering:
            for et in exclude_engineering.split(","):
                et = et.strip()
                if et:
                    conditions.append("(engineering_type IS NULL OR engineering_type != ?)")
                    params.append(et)
        # Include only specific engineering types (comma-separated)
        if engineering:
            or_parts = []
            engineering_params: list[Any] = []
            for et in engineering.split(","):
                clause, clause_params = _engineering_match_clause(et)
                if clause:
                    or_parts.append(clause)
                    engineering_params.extend(clause_params)
            if or_parts:
                conditions.append("(" + " OR ".join(or_parts) + ")")
                params.extend(engineering_params)
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        # Sort
        sort_col = "opportunity_score"
        if sort_by == "bid_deadline":
            sort_col = "bid_deadline"
        elif sort_by == "publish_time":
            sort_col = "publish_time"
        elif sort_by == "opportunity_score":
            sort_col = "opportunity_score"
        direction = "DESC" if sort_order == "desc" else "ASC"
        publish_expr = "datetime(substr(NULLIF(publish_time, ''), 1, 19))"
        deadline_expr = "datetime(substr(NULLIF(bid_deadline, ''), 1, 19))"
        if sort_col == "opportunity_score":
            order_clause = (
                f"ORDER BY opportunity_score {direction}, "
                f"({publish_expr} IS NULL) ASC, {publish_expr} DESC, "
                "publish_time DESC, id DESC"
            )
        elif sort_col == "publish_time":
            order_clause = (
                f"ORDER BY ({publish_expr} IS NULL) ASC, {publish_expr} {direction}, "
                f"publish_time {direction}, opportunity_score DESC, id DESC"
            )
        elif sort_col == "bid_deadline":
            order_clause = (
                f"ORDER BY ({deadline_expr} IS NULL) ASC, {deadline_expr} {direction}, "
                f"bid_deadline {direction}, opportunity_score DESC, id DESC"
            )
        else:
            order_clause = f"ORDER BY {sort_col} {direction}, opportunity_score DESC, id DESC"
        params.extend([limit, offset])
        rows = conn.execute(
            f"""
            SELECT * FROM announcements
            {where}
            {order_clause}
            LIMIT ? OFFSET ?
            """,
            params,
        ).fetchall()
    return [_row_to_announcement(row) for row in rows]


def count_announcements(
    search: str = "",
    source_key: str = "",
    days: int = 0,
    exclude_engineering: str = "",
    engineering: str = "",
) -> int:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conditions = []
        params: list[Any] = []
        if search:
            conditions.append(
                "(title LIKE ? OR project_name LIKE ? OR tenderer LIKE ? OR bid_section_name LIKE ?)"
            )
            like = f"%{search}%"
            params.extend([like, like, like, like])
        if source_key:
            conditions.append("source_key = ?")
            params.append(source_key)
        if days > 0:
            conditions.append("publish_time >= date('now', ?)")
            params.append(f"-{days} days")
        if exclude_engineering:
            for et in exclude_engineering.split(","):
                et = et.strip()
                if et:
                    conditions.append("(engineering_type IS NULL OR engineering_type != ?)")
                    params.append(et)
        if engineering:
            or_parts = []
            engineering_params: list[Any] = []
            for et in engineering.split(","):
                clause, clause_params = _engineering_match_clause(et)
                if clause:
                    or_parts.append(clause)
                    engineering_params.extend(clause_params)
            if or_parts:
                conditions.append("(" + " OR ".join(or_parts) + ")")
                params.extend(engineering_params)
        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        row = conn.execute(
            f"SELECT COUNT(*) as cnt FROM announcements {where}",
            params,
        ).fetchone()
        return row[0] if row else 0


def get_announcement_by_id(ann_id: int) -> Announcement | None:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM announcements WHERE id = ?", (ann_id,)
        ).fetchone()
        if not row:
            return None
        return _row_to_announcement(row)


def _row_to_announcement(row: sqlite3.Row) -> Announcement:
    keys = set(row.keys())
    return Announcement(
        id=row["id"],
        source_name=row["source_name"],
        source_key=row["source_key"],
        title=row["title"],
        url=row["url"],
        publish_time=row["publish_time"],
        notice_type=row["notice_type"],
        notice_sub_type=row["notice_sub_type"],
        region=row["region"] if "region" in keys else "",
        project_name=row["project_name"] if "project_name" in keys else "",
        project_code=row["project_code"] if "project_code" in keys else "",
        bid_section_name=row["bid_section_name"] if "bid_section_name" in keys else "",
        tenderer=row["tenderer"] if "tenderer" in keys else "",
        bid_deadline=row["bid_deadline"] if "bid_deadline" in keys else "",
        engineering_type=row["engineering_type"] if "engineering_type" in keys else "",
        bid_method=row["bid_method"] if "bid_method" in keys else "",
        detail_content=row["detail_content"] if "detail_content" in keys else "",
        detail_fetched=bool(row["detail_fetched"]) if "detail_fetched" in keys else False,
        opportunity_score=int(row["opportunity_score"]) if "opportunity_score" in keys else 0,
        agent_summary=row["agent_summary"] if "agent_summary" in keys else "",
        agent_tags=row["agent_tags"] if "agent_tags" in keys else "",
        agent_action=row["agent_action"] if "agent_action" in keys else "",
        agent_analyzed=bool(row["agent_analyzed"]) if "agent_analyzed" in keys else False,
        agent_stage=row["agent_stage"] if "agent_stage" in keys else "none",
        agent_confidence=float(row["agent_confidence"]) if "agent_confidence" in keys else 0.0,
        agent_error=row["agent_error"] if "agent_error" in keys else "",
        agent_updated_at=row["agent_updated_at"] if "agent_updated_at" in keys else "",
        raw=json.loads(row["raw_json"]),
        first_seen_at=datetime.fromisoformat(row["first_seen_at"]),
    )


def get_source_state(source_key: str, source_name: str) -> SourceState:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM source_states WHERE source_key = ?",
            (source_key,),
        ).fetchone()
        if row:
            return _row_to_source_state(row)

        now = datetime.now()
        conn.execute(
            """
            INSERT INTO source_states (
                source_key, source_name, consecutive_failures,
                is_paused, last_error, updated_at
            )
            VALUES (?, ?, 0, 0, '', ?)
            """,
            (source_key, source_name, now.isoformat()),
        )
        conn.commit()
        return SourceState(
            source_key=source_key,
            source_name=source_name,
            consecutive_failures=0,
            is_paused=False,
            last_error="",
            updated_at=now,
        )


def record_source_success(source_key: str, source_name: str) -> None:
    init_db()
    now = datetime.now().isoformat()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO source_states (
                source_key, source_name, consecutive_failures,
                is_paused, last_error, updated_at
            )
            VALUES (?, ?, 0, 0, '', ?)
            ON CONFLICT(source_key) DO UPDATE SET
                source_name = excluded.source_name,
                consecutive_failures = 0,
                is_paused = 0,
                last_error = '',
                updated_at = excluded.updated_at
            """,
            (source_key, source_name, now),
        )
        conn.commit()


def record_source_failure(
    source_key: str,
    source_name: str,
    error: str,
    max_failures: int = 3,
) -> SourceState:
    current = get_source_state(source_key, source_name)
    failures = current.consecutive_failures + 1
    is_paused = failures >= max_failures
    now = datetime.now()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            UPDATE source_states
            SET source_name = ?,
                consecutive_failures = ?,
                is_paused = ?,
                last_error = ?,
                updated_at = ?
            WHERE source_key = ?
            """,
            (
                source_name,
                failures,
                1 if is_paused else 0,
                error[:500],
                now.isoformat(),
                source_key,
            ),
        )
        conn.commit()
    return SourceState(
        source_key=source_key,
        source_name=source_name,
        consecutive_failures=failures,
        is_paused=is_paused,
        last_error=error[:500],
        updated_at=now,
    )


def list_source_states() -> list[SourceState]:
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM source_states ORDER BY source_name"
        ).fetchall()
    return [_row_to_source_state(row) for row in rows]


def _row_to_source_state(row: sqlite3.Row) -> SourceState:
    return SourceState(
        source_key=row["source_key"],
        source_name=row["source_name"],
        consecutive_failures=row["consecutive_failures"],
        is_paused=bool(row["is_paused"]),
        last_error=row["last_error"],
        updated_at=datetime.fromisoformat(row["updated_at"]),
    )
