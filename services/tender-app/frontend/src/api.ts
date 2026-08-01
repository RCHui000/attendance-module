import type {
  AgentSettings,
  AgentSettingsPublic,
  Announcement,
  AnnouncementListResponse,
  BillingRun,
  BillingSummary,
  CrawlScheduleSettings,
  CrawlSummary,
  SourceCrawlRun,
} from "@/types"

const APP_BASE = import.meta.env.BASE_URL || "/"
const BASE = `${APP_BASE.replace(/\/$/, "")}/api`

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, opts)
  if (!res.ok) {
    throw new Error(await res.text().catch(() => res.statusText))
  }
  return res.json()
}

export function fetchAnnouncements(params: {
  limit?: number
  offset?: number
  search?: string
  source_key?: string
  days?: number
  exclude_engineering?: string
  engineering?: string
  sort_by?: string
  sort_order?: string
}): Promise<AnnouncementListResponse> {
  const sp = new URLSearchParams()
  if (params.limit) sp.set("limit", String(params.limit))
  if (params.offset) sp.set("offset", String(params.offset))
  if (params.search) sp.set("search", params.search)
  if (params.source_key) sp.set("source_key", params.source_key)
  if (params.days) sp.set("days", String(params.days))
  if (params.exclude_engineering) sp.set("exclude_engineering", params.exclude_engineering)
  if (params.engineering) sp.set("engineering", params.engineering)
  if (params.sort_by) sp.set("sort_by", params.sort_by)
  if (params.sort_order) sp.set("sort_order", params.sort_order)
  return request(`/announcements?${sp.toString()}`)
}

export function fetchAnnouncementDetail(id: number): Promise<Announcement> {
  return request(`/announcements/${id}`)
}

export function triggerCrawl(): Promise<CrawlSummary> {
  return request("/announcements/crawl", { method: "POST" })
}

export interface CrawlJobStatus {
  running: boolean
  phase: string
  started_at: string
  finished_at: string
  result: CrawlSummary | null
  billing: BillingRun | null
  error: string
}

export function startCrawlJob(): Promise<CrawlJobStatus> {
  return request("/announcements/crawl/start", { method: "POST" })
}

export function fetchCrawlStatus(): Promise<CrawlJobStatus> {
  return request("/announcements/crawl/status")
}

export function fetchLatestCrawlRuns(): Promise<SourceCrawlRun[]> {
  return request("/announcements/crawl/latest")
}

export function fetchCrawlSchedule(): Promise<CrawlScheduleSettings> {
  return request("/schedule/crawl")
}

export function saveCrawlSchedule(settings: CrawlScheduleSettings): Promise<CrawlScheduleSettings> {
  return request("/schedule/crawl", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  })
}

export function fetchBillingSummary(): Promise<BillingSummary> {
  return request("/billing/summary")
}

export function fetchBillingRuns(limit = 50): Promise<BillingRun[]> {
  return request(`/billing/runs?limit=${limit}`)
}

export function triggerCrawlDetails(limit = 30): Promise<{ fetched: number; message: string }> {
  return request(`/announcements/crawl-detail?limit=${limit}`, { method: "POST" })
}

export function triggerAgentAnalysis(
  limit = 50,
  options: { fetchDetails?: boolean; force?: boolean } = {},
): Promise<{ analyzed: number; detail_fetched: number; message: string }> {
  const sp = new URLSearchParams()
  sp.set("limit", String(limit))
  if (options.fetchDetails) sp.set("fetch_details", "true")
  if (options.force) sp.set("force", "true")
  return request(`/agent/analyze?${sp.toString()}`, { method: "POST" })
}

// ─── Source Config ────────────────────────────────────

export interface SourceConfig {
  id: number | null
  source_key: string
  name: string
  list_url: string
  source_type: string
  enabled: boolean
  created_at: string | null
}

export function fetchSourceConfigs(): Promise<SourceConfig[]> {
  return request("/sources/configs")
}

export function saveSourceConfig(cfg: SourceConfig): Promise<SourceConfig> {
  if (cfg.id) {
    return request(`/sources/configs/${cfg.source_key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    })
  }
  return request("/sources/configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  })
}

export function deleteSourceConfig(source_key: string): Promise<{ status: string }> {
  return request(`/sources/configs/${source_key}`, { method: "DELETE" })
}

export function fetchAgentSettings(): Promise<AgentSettingsPublic> {
  return request("/agent/settings")
}

export function saveAgentSettings(settings: AgentSettings): Promise<AgentSettingsPublic> {
  return request("/agent/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  })
}
