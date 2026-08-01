import asyncio
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.billing import fetch_agent_balance
from app.crawler import AnnouncementCrawler
from app.schemas import (
    AgentSettings, AgentSettingsPublic, Announcement, BillingRun, BillingSummary,
    CrawlScheduleSettings, CrawlSummary, ScheduleTask, SourceConfig, SourceCrawlRun, SourceState,
)
from app.storage import (
    count_announcements,
    create_billing_run,
    delete_source_config,
    finish_billing_run,
    get_agent_settings_public,
    get_announcement_by_id,
    get_billing_summary,
    get_crawl_schedule_settings,
    get_opportunities,
    get_recent_new,
    latest_source_crawl_runs,
    list_source_crawl_runs,
    init_db,
    list_billing_runs,
    list_announcements,
    list_source_configs,
    list_source_states,
    save_agent_settings,
    save_crawl_schedule_settings,
    upsert_source_config,
)

crawler = AnnouncementCrawler()
daily_task: asyncio.Task | None = None
crawl_lock = threading.Lock()
crawl_status: dict[str, Any] = {
    "running": False,
    "phase": "idle",
    "started_at": "",
    "finished_at": "",
    "result": None,
    "billing": None,
    "error": "",
    "lookback_days": 1,
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global daily_task
    init_db()
    schedule = get_crawl_schedule_settings()
    with crawl_lock:
        crawl_status["lookback_days"] = schedule.lookback_days
    daily_task = asyncio.create_task(daily_crawl_loop())
    try:
        yield
    finally:
        if daily_task:
            daily_task.cancel()


app = FastAPI(
    title="招标信息聚合",
    version="0.4.0",
    lifespan=lifespan,
)


# ------------------------------------------------------------------
# Crawl
# ------------------------------------------------------------------

@app.post("/api/announcements/crawl", response_model=CrawlSummary)
async def crawl_announcements() -> CrawlSummary:
    schedule = get_crawl_schedule_settings()
    task = _default_crawl_task(schedule)
    return await asyncio.to_thread(crawler.crawl_all, task.lookback_days)


@app.post("/api/announcements/crawl/start", response_model=dict[str, Any])
async def start_crawl(background_tasks: BackgroundTasks) -> dict[str, Any]:
    schedule = get_crawl_schedule_settings()
    task = _default_crawl_task(schedule)
    with crawl_lock:
        if crawl_status["running"]:
            return dict(crawl_status)
        crawl_status.update({
            "running": True,
            "phase": "queued",
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "finished_at": "",
            "result": None,
            "billing": None,
            "error": "",
            "lookback_days": task.lookback_days,
            "scheduled_action": task.action,
        })
    background_tasks.add_task(_run_crawl_job, task)
    return dict(crawl_status)


@app.get("/api/announcements/crawl/status", response_model=dict[str, Any])
async def get_crawl_status() -> dict[str, Any]:
    with crawl_lock:
        return dict(crawl_status)


@app.get("/api/schedule/crawl", response_model=CrawlScheduleSettings)
async def crawl_schedule() -> CrawlScheduleSettings:
    return get_crawl_schedule_settings()


@app.put("/api/schedule/crawl", response_model=CrawlScheduleSettings)
async def update_crawl_schedule(settings: CrawlScheduleSettings) -> CrawlScheduleSettings:
    return save_crawl_schedule_settings(settings)


@app.get("/api/announcements/crawl/runs", response_model=list[SourceCrawlRun])
async def source_crawl_runs(
    limit: int = Query(default=20, ge=1, le=200),
    crawl_date: str = Query(default=""),
) -> list[SourceCrawlRun]:
    return list_source_crawl_runs(limit=limit, crawl_date=crawl_date)


@app.get("/api/announcements/crawl/latest", response_model=list[SourceCrawlRun])
async def latest_crawl_runs(crawl_date: str = Query(default="")) -> list[SourceCrawlRun]:
    return latest_source_crawl_runs(crawl_date=crawl_date)


@app.post("/api/announcements/crawl-detail", response_model=dict[str, Any])
async def crawl_pending_details(limit: int = Query(default=30, ge=1, le=100)) -> dict[str, Any]:
    return await asyncio.to_thread(crawler.fetch_pending_details, limit)


# ------------------------------------------------------------------
# Announcements
# ------------------------------------------------------------------

@app.get("/api/announcements", response_model=dict[str, Any])
async def announcements(
    limit: int = Query(default=500, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    search: str = Query(default=""),
    source_key: str = Query(default=""),
    days: int = Query(default=0, ge=0),
    exclude_engineering: str = Query(default=""),
    engineering: str = Query(default=""),
    sort_by: str = Query(default="opportunity_score"),
    sort_order: str = Query(default="desc"),
) -> dict[str, Any]:
    items = list_announcements(
        limit=limit, offset=offset, search=search, source_key=source_key,
        days=days, exclude_engineering=exclude_engineering, engineering=engineering,
        sort_by=sort_by, sort_order=sort_order,
    )
    total = count_announcements(search=search, source_key=source_key, days=days,
                                exclude_engineering=exclude_engineering, engineering=engineering)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@app.get("/api/announcements/recent", response_model=dict[str, Any])
async def recent_new() -> dict[str, Any]:
    items = get_recent_new(limit=50)
    return {"items": items, "total": len(items)}


@app.get("/api/announcements/{ann_id}", response_model=Announcement)
async def announcement_detail(ann_id: int) -> Announcement:
    item = get_announcement_by_id(ann_id)
    if not item:
        raise HTTPException(status_code=404, detail="not found")
    if not item.detail_fetched:
        result = await asyncio.to_thread(crawler.fetch_detail_for_announcement, item)
        if result:
            item = result
        else:
            item = get_announcement_by_id(ann_id) or item
    return item


# ------------------------------------------------------------------
# Agent
# ------------------------------------------------------------------

@app.post("/api/agent/analyze", response_model=dict[str, Any])
async def run_agent_analysis(
    limit: int = Query(default=50, ge=1, le=100),
    fetch_details: bool = Query(default=False),
    force: bool = Query(default=False),
) -> dict[str, Any]:
    return await asyncio.to_thread(crawler.run_agent_pipeline, limit, fetch_details, force)


@app.get("/api/agent/settings", response_model=AgentSettingsPublic)
async def agent_settings() -> AgentSettingsPublic:
    return get_agent_settings_public()


@app.put("/api/agent/settings", response_model=AgentSettingsPublic)
async def update_agent_settings(settings: AgentSettings) -> AgentSettingsPublic:
    return save_agent_settings(settings)


# ------------------------------------------------------------------
# Opportunities
# ------------------------------------------------------------------

@app.get("/api/opportunities", response_model=dict[str, Any])
async def opportunities(
    days: int = Query(default=15, ge=1, le=60),
    min_score: int = Query(default=3, ge=1, le=5),
) -> dict[str, Any]:
    items = get_opportunities(limit=100, days=days, min_score=min_score)
    return {"items": items, "total": len(items), "days": days, "min_score": min_score}


# ------------------------------------------------------------------
# Billing
# ------------------------------------------------------------------

@app.get("/api/billing/summary", response_model=BillingSummary)
async def billing_summary(limit: int = Query(default=50, ge=1, le=500)) -> BillingSummary:
    return get_billing_summary(limit)


@app.get("/api/billing/runs", response_model=list[BillingRun])
async def billing_runs(limit: int = Query(default=50, ge=1, le=500)) -> list[BillingRun]:
    return list_billing_runs(limit)


# ------------------------------------------------------------------
# Sources — config CRUD
# ------------------------------------------------------------------

@app.get("/api/sources/configs", response_model=list[SourceConfig])
async def source_configs() -> list[SourceConfig]:
    return list_source_configs()


@app.post("/api/sources/configs", response_model=SourceConfig)
async def create_source_config(cfg: SourceConfig) -> SourceConfig:
    return upsert_source_config(cfg)


@app.put("/api/sources/configs/{source_key}", response_model=SourceConfig)
async def update_source_config(source_key: str, cfg: SourceConfig) -> SourceConfig:
    cfg.source_key = source_key
    return upsert_source_config(cfg)


@app.delete("/api/sources/configs/{source_key}")
async def remove_source_config(source_key: str) -> dict[str, str]:
    if not delete_source_config(source_key):
        raise HTTPException(status_code=404, detail="not found")
    return {"status": "deleted"}


# ------------------------------------------------------------------
# Sources — states
# ------------------------------------------------------------------

@app.get("/api/sources/states", response_model=list[SourceState])
async def source_states() -> list[SourceState]:
    return list_source_states()


# ------------------------------------------------------------------
# Scheduled
# ------------------------------------------------------------------

def _default_crawl_task(schedule: CrawlScheduleSettings) -> ScheduleTask:
    for task in schedule.tasks:
        if task.action == "crawl_sources":
            return task
    return ScheduleTask(
        id="default-crawl",
        enabled=schedule.enabled,
        action="crawl_sources",
        hour=schedule.hour,
        minute=schedule.minute,
        lookback_days=schedule.lookback_days,
    )


def _task_run_at(task: ScheduleTask, now: datetime) -> datetime:
    run_at = now.replace(hour=task.hour, minute=task.minute, second=0, microsecond=0)
    if run_at <= now:
        run_at += timedelta(days=1)
    return run_at


def _next_scheduled_tasks(schedule: CrawlScheduleSettings, now: datetime) -> tuple[datetime, list[ScheduleTask]] | None:
    if not schedule.enabled:
        return None
    enabled_tasks = [task for task in schedule.tasks if task.enabled]
    if not enabled_tasks:
        return None
    candidates = [(_task_run_at(task, now), task) for task in enabled_tasks]
    next_run = min(run_at for run_at, _ in candidates)
    due_tasks = [
        task
        for run_at, task in candidates
        if run_at == next_run
    ]
    return next_run, sorted(due_tasks, key=lambda task: (task.sort_order, task.id))


def _run_crawl_job(task: ScheduleTask | None = None) -> None:
    with crawl_lock:
        crawl_status["phase"] = "running"
    schedule = get_crawl_schedule_settings()
    active_task = task or _default_crawl_task(schedule)
    start_snapshot = fetch_agent_balance()
    billing_run = create_billing_run(
        job_type="crawl",
        start_balance=start_snapshot.balance,
        currency=start_snapshot.currency,
        provider=start_snapshot.provider,
        error=start_snapshot.error,
    )
    with crawl_lock:
        crawl_status["billing"] = billing_run.model_dump(mode="json")
        crawl_status["lookback_days"] = active_task.lookback_days
        crawl_status["scheduled_action"] = active_task.action
    try:
        result = crawler.crawl_all(lookback_days=active_task.lookback_days)
        end_snapshot = fetch_agent_balance()
        finished_billing = finish_billing_run(
            billing_run.id,
            end_balance=end_snapshot.balance,
            currency=end_snapshot.currency,
            provider=end_snapshot.provider,
            status="finished",
            error=end_snapshot.error,
        )
        with crawl_lock:
            crawl_status.update({
                "running": False,
                "phase": "finished",
                "finished_at": datetime.now().isoformat(timespec="seconds"),
                "result": result.model_dump(mode="json"),
                "billing": finished_billing.model_dump(mode="json") if finished_billing else None,
                "error": "",
            })
    except Exception as exc:
        end_snapshot = fetch_agent_balance()
        finished_billing = finish_billing_run(
            billing_run.id,
            end_balance=end_snapshot.balance,
            currency=end_snapshot.currency,
            provider=end_snapshot.provider,
            status="failed",
            error=f"{type(exc).__name__}: {exc}; {end_snapshot.error}".strip("; "),
        )
        with crawl_lock:
            crawl_status.update({
                "running": False,
                "phase": "failed",
                "finished_at": datetime.now().isoformat(timespec="seconds"),
                "billing": finished_billing.model_dump(mode="json") if finished_billing else None,
                "error": f"{type(exc).__name__}: {exc}",
            })


def _run_agent_job(task: ScheduleTask) -> None:
    with crawl_lock:
        if crawl_status["running"]:
            print("[Scheduler] agent analysis skipped because another job is running", flush=True)
            return
        crawl_status.update({
            "running": True,
            "phase": "agent_scheduled",
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "finished_at": "",
            "result": None,
            "billing": None,
            "error": "",
            "lookback_days": 0,
            "scheduled_action": task.action,
        })
    start_snapshot = fetch_agent_balance()
    billing_run = create_billing_run(
        job_type="agent_analysis",
        start_balance=start_snapshot.balance,
        currency=start_snapshot.currency,
        provider=start_snapshot.provider,
        error=start_snapshot.error,
    )
    with crawl_lock:
        crawl_status["billing"] = billing_run.model_dump(mode="json")
    try:
        result = crawler.run_agent_pipeline(
            limit=None,
            fetch_details=task.fetch_details,
            force=task.force,
        )
        end_snapshot = fetch_agent_balance()
        finished_billing = finish_billing_run(
            billing_run.id,
            end_balance=end_snapshot.balance,
            currency=end_snapshot.currency,
            provider=end_snapshot.provider,
            status="finished",
            error=end_snapshot.error,
        )
        with crawl_lock:
            crawl_status.update({
                "running": False,
                "phase": "finished",
                "finished_at": datetime.now().isoformat(timespec="seconds"),
                "result": result,
                "billing": finished_billing.model_dump(mode="json") if finished_billing else None,
                "error": "",
            })
    except Exception as exc:
        end_snapshot = fetch_agent_balance()
        finished_billing = finish_billing_run(
            billing_run.id,
            end_balance=end_snapshot.balance,
            currency=end_snapshot.currency,
            provider=end_snapshot.provider,
            status="failed",
            error=f"{type(exc).__name__}: {exc}; {end_snapshot.error}".strip("; "),
        )
        with crawl_lock:
            crawl_status.update({
                "running": False,
                "phase": "failed",
                "finished_at": datetime.now().isoformat(timespec="seconds"),
                "billing": finished_billing.model_dump(mode="json") if finished_billing else None,
                "error": f"{type(exc).__name__}: {exc}",
            })


def _run_scheduled_task(task: ScheduleTask) -> None:
    if task.action == "agent_analyze":
        _run_agent_job(task)
    else:
        with crawl_lock:
            if crawl_status["running"]:
                print("[Scheduler] crawl skipped because another job is running", flush=True)
                return
            crawl_status.update({
                "running": True,
                "phase": "scheduled",
                "started_at": datetime.now().isoformat(timespec="seconds"),
                "finished_at": "",
                "result": None,
                "billing": None,
                "error": "",
                "lookback_days": task.lookback_days,
                "scheduled_action": task.action,
            })
        _run_crawl_job(task)


def _run_scheduled_tasks(tasks: list[ScheduleTask]) -> None:
    for task in sorted(tasks, key=lambda item: (item.sort_order, item.id)):
        print(
            f"[Scheduler] running task #{task.sort_order + 1}: {task.action} at {task.hour:02d}:{task.minute:02d}",
            flush=True,
        )
        _run_scheduled_task(task)


async def daily_crawl_loop() -> None:
    while True:
        now = datetime.now()
        schedule = get_crawl_schedule_settings()
        next_item = _next_scheduled_tasks(schedule, now)
        if not next_item:
            print("[Scheduler] no enabled schedule tasks; checking again in 60 seconds", flush=True)
            await asyncio.sleep(60)
            continue
        next_run, next_tasks = next_item
        action_names = ", ".join(f"#{task.sort_order + 1}:{task.action}" for task in next_tasks)
        print(
            f"[Scheduler] next scheduled tasks at {next_run.isoformat(timespec='seconds')}: {action_names}",
            flush=True,
        )
        wait_seconds = (next_run - now).total_seconds()
        if wait_seconds > 60:
            await asyncio.sleep(60)
            continue
        await asyncio.sleep(max(0, wait_seconds))
        schedule = get_crawl_schedule_settings()
        if not schedule.enabled:
            print("[Scheduler] task skipped because it is disabled", flush=True)
            continue
        current_tasks = [
            task
            for task in schedule.tasks
            if task.enabled and task.hour == next_run.hour and task.minute == next_run.minute
        ]
        if not current_tasks:
            print("[Scheduler] due tasks skipped because they are disabled", flush=True)
            continue
        await asyncio.to_thread(_run_scheduled_tasks, current_tasks)


# ------------------------------------------------------------------
# Serve built frontend (must be after all API routes)
# ------------------------------------------------------------------
FE_DIST = Path(__file__).parent.parent.parent / "frontend-dist"
if not FE_DIST.exists():
    FE_DIST = Path(__file__).parent.parent / "frontend-dist"
if FE_DIST.exists():
    assets_dir = FE_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

    @app.get("/", response_class=HTMLResponse)
    async def frontend_index():
        return FileResponse(FE_DIST / "index.html")

    @app.get("/{full_path:path}", response_class=HTMLResponse)
    async def frontend_spa(full_path: str):
        target = FE_DIST / full_path
        if target.exists() and target.is_file():
            return FileResponse(target)
        return FileResponse(FE_DIST / "index.html")
else:
    @app.get("/", response_class=HTMLResponse)
    async def index_dev():
        return "<h1>Dev mode</h1><p>Run <code>cd frontend && npm run dev</code> for frontend.</p>"
