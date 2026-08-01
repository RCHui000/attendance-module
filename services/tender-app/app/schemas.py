from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, HttpUrl


class ProbeRequest(BaseModel):
    name: str = Field(default="未命名公告源", min_length=1, max_length=120)
    url: HttpUrl


class ProbeSignal(BaseModel):
    name: str
    severity: str
    detail: str


class ProbeResult(BaseModel):
    id: int | None = None
    source_name: str
    url: str
    level: str
    score: int
    summary: str
    recommendation: str
    signals: list[ProbeSignal]
    metrics: dict[str, Any]
    created_at: datetime


class Announcement(BaseModel):
    id: int | None = None
    source_name: str
    source_key: str
    title: str
    url: str
    publish_time: str
    notice_type: str = "招标公告"
    notice_sub_type: str = "招标公告"
    region: str = ""
    project_name: str = ""
    project_code: str = ""
    bid_section_name: str = ""
    tenderer: str = ""
    bid_deadline: str = ""
    engineering_type: str = ""
    bid_method: str = ""
    detail_content: str = ""
    detail_fetched: bool = False
    opportunity_score: int = 0
    agent_summary: str = ""
    agent_tags: str = ""
    agent_action: str = ""
    agent_analyzed: bool = False
    agent_stage: str = "none"
    agent_confidence: float = 0.0
    agent_error: str = ""
    agent_updated_at: str = ""
    raw: dict[str, Any] = Field(default_factory=dict)
    first_seen_at: datetime


class CrawlSummary(BaseModel):
    source_count: int
    fetched_count: int
    inserted_count: int
    skipped_count: int
    blocked_count: int
    detail_fetched_count: int = 0
    messages: list[str]
    announcements: list[Announcement]


class SourceState(BaseModel):
    source_key: str
    source_name: str
    consecutive_failures: int
    is_paused: bool
    last_error: str = ""
    updated_at: datetime


class SourceConfig(BaseModel):
    id: int | None = None
    source_key: str
    name: str
    list_url: str
    source_type: str = "shenzhen"  # shenzhen or beijing
    enabled: bool = True
    created_at: datetime | None = None


class SourceCrawlRun(BaseModel):
    id: int | None = None
    source_key: str
    source_name: str
    crawl_date: str
    target_start_time: str
    target_end_time: str
    expected_total_count: int | None = None
    expected_total_pages: int | None = None
    fetched_pages: list[int] = Field(default_factory=list)
    fetched_count: int = 0
    first_publish_time: str = ""
    last_publish_time: str = ""
    reached_date_boundary: bool = False
    hit_page_cap: bool = False
    error_pages: list[str] = Field(default_factory=list)
    completeness_status: str = "unknown"
    started_at: datetime
    finished_at: datetime
    message: str = ""


class AgentSettings(BaseModel):
    api_base: str = "https://api.deepseek.com/v1"
    model: str = "deepseek-chat"
    api_key: str = ""
    enabled: bool = False


class AgentSettingsPublic(BaseModel):
    api_base: str = "https://api.deepseek.com/v1"
    model: str = "deepseek-chat"
    api_key_masked: str = ""
    enabled: bool = False


class ScheduleTask(BaseModel):
    id: str = ""
    sort_order: int = Field(default=0, ge=0)
    enabled: bool = True
    action: Literal["crawl_sources", "agent_analyze"] = "crawl_sources"
    hour: int = Field(default=8, ge=0, le=23)
    minute: int = Field(default=30, ge=0, le=59)
    lookback_days: int = Field(default=3, ge=1, le=30)
    agent_limit: int = Field(default=50, ge=1, le=100)
    fetch_details: bool = True
    force: bool = False


class CrawlScheduleSettings(BaseModel):
    enabled: bool = True
    hour: int = Field(default=8, ge=0, le=23)
    minute: int = Field(default=30, ge=0, le=59)
    lookback_days: int = Field(default=3, ge=1, le=30)
    action: str = "crawl_sources"
    tasks: list[ScheduleTask] = Field(default_factory=list)


class BillingRun(BaseModel):
    id: int | None = None
    job_type: str = "crawl"
    started_at: datetime
    finished_at: datetime | None = None
    start_balance: float | None = None
    end_balance: float | None = None
    cost: float | None = None
    currency: str = ""
    provider: str = ""
    status: str = "running"
    error: str = ""


class BillingSummary(BaseModel):
    total_cost: float
    run_count: int
    priced_run_count: int = 0
    failed_run_count: int = 0
    currency: str = ""
    last_run: BillingRun | None = None
