export interface Announcement {
  id: number
  source_name: string
  source_key: string
  title: string
  url: string
  publish_time: string
  notice_type: string
  notice_sub_type: string
  region: string
  project_name: string
  project_code: string
  bid_section_name: string
  tenderer: string
  bid_deadline: string
  engineering_type: string
  bid_method: string
  detail_content: string
  detail_fetched: boolean
  opportunity_score: number
  agent_summary: string
  agent_tags: string
  agent_action: string
  agent_analyzed: boolean
  agent_stage: string
  agent_confidence: number
  agent_error: string
  agent_updated_at: string
  first_seen_at: string
}

export interface AnnouncementListResponse {
  items: Announcement[]
  total: number
  limit: number
  offset: number
}

export interface CrawlSummary {
  source_count: number
  fetched_count: number
  inserted_count: number
  skipped_count: number
  blocked_count: number
  detail_fetched_count: number
  messages: string[]
  announcements: Announcement[]
}

export interface SourceCrawlRun {
  id: number | null
  source_key: string
  source_name: string
  crawl_date: string
  target_start_time: string
  target_end_time: string
  expected_total_count: number | null
  expected_total_pages: number | null
  fetched_pages: number[]
  fetched_count: number
  first_publish_time: string
  last_publish_time: string
  reached_date_boundary: boolean
  hit_page_cap: boolean
  error_pages: string[]
  completeness_status: "complete" | "partial" | "unknown" | "failed" | string
  started_at: string
  finished_at: string
  message: string
}

export interface AgentSettings {
  api_base: string
  model: string
  api_key: string
  enabled: boolean
}

export interface AgentSettingsPublic {
  api_base: string
  model: string
  api_key_masked: string
  enabled: boolean
}

export interface CrawlScheduleSettings {
  enabled: boolean
  hour: number
  minute: number
  lookback_days: number
  action: string
  tasks: ScheduleTask[]
}

export interface ScheduleTask {
  id: string
  sort_order: number
  enabled: boolean
  action: "crawl_sources" | "agent_analyze"
  hour: number
  minute: number
  lookback_days: number
  agent_limit: number
  fetch_details: boolean
  force: boolean
}

export interface BillingRun {
  id: number | null
  job_type: string
  started_at: string
  finished_at: string | null
  start_balance: number | null
  end_balance: number | null
  cost: number | null
  currency: string
  provider: string
  status: string
  error: string
}

export interface BillingSummary {
  total_cost: number
  run_count: number
  priced_run_count: number
  failed_run_count: number
  currency: string
  last_run: BillingRun | null
}
