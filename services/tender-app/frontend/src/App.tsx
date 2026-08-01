/* eslint-disable react-hooks/set-state-in-effect */
import { Children, cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  FileSearch,
  Loader2,
  RefreshCcw,
  Search,
  Settings,
  Star,
  X,
} from "lucide-react"

import {
  fetchAnnouncementDetail,
  fetchAnnouncements,
  fetchCrawlStatus,
  fetchLatestCrawlRuns,
  startCrawlJob,
  triggerAgentAnalysis,
} from "@/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Announcement, SourceCrawlRun } from "@/types"

const CONFIG_URL = `${(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/")}config`

type ViewMode = "focus" | "rules" | "all"

const SOURCES = [
  { value: "", label: "全部来源" },
  { value: "shenzhen_jsgc_zbgg", label: "深圳" },
  { value: "beijing_gcjs_zbgg", label: "北京" },
]

const DAY_OPTIONS = [
  { value: 0, label: "全部" },
  { value: 3, label: "3天" },
  { value: 7, label: "7天" },
  { value: 15, label: "15日" },
  { value: 30, label: "30日" },
]

const ENGINEERING_TYPES = ["全部", "施工", "设计", "咨询", "监理", "勘察", "设备", "其他"]

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function formatDate(value: string) {
  if (!value) return "未披露"
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[2]}/${match[3]}` : value.slice(0, 10)
}

function formatDateTime(value: string) {
  if (!value) return "未披露"
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : value.slice(0, 16)
}

function sourceLabel(sourceKey: string) {
  if (sourceKey.includes("beijing")) return "北京"
  if (sourceKey.includes("shenzhen")) return "深圳"
  return "其他"
}

function parseTags(value: string) {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean)
}

function scoreLabel(score: number) {
  if (score >= 5) return "强关注"
  if (score >= 4) return "重点跟进"
  if (score >= 3) return "可关注"
  if (score > 0) return "低相关"
  return "待研判"
}

function scoreClass(score: number) {
  if (score >= 5) return "bg-[#111827] text-white"
  if (score >= 4) return "bg-amber-500 text-white"
  if (score >= 3) return "bg-blue-600 text-white"
  if (score > 0) return "bg-[#f2f4f7] text-[#344054]"
  return "bg-white text-[#667085] ring-1 ring-[#e4e7ec]"
}

function statusClass(status: string) {
  if (status === "complete") return "border-[#b8c4d6] bg-[#eef4ff] text-[#344054]"
  if (status === "partial") return "border-amber-200 bg-amber-50 text-amber-800"
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700"
  return "border-[#e4e7ec] bg-[#f8fafc] text-[#667085]"
}

function statusText(status: string) {
  if (status === "complete") return "完整"
  if (status === "partial") return "部分"
  if (status === "failed") return "失败"
  return "未知"
}

function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 h-8 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#101318]/20",
        active ? "text-white" : "text-[#475467] hover:text-[#101318]",
      )}
    >
      {children}
    </button>
  )
}

function SegmentGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children)
  const activeIndex = Math.max(
    0,
    items.findIndex((child) => isValidElement<{ active?: boolean }>(child) && Boolean(child.props.active)),
  )
  const itemWidth = `${100 / Math.max(items.length, 1)}%`

  return (
    <div
      className={cn(
        "relative inline-grid h-10 overflow-hidden rounded-full border border-[#d9dee8] bg-white p-1 shadow-[0_2px_8px_rgba(16,24,40,0.10)]",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      <span className="pointer-events-none absolute inset-1 overflow-hidden rounded-full">
        <span
          className="absolute left-0 top-0 h-full rounded-full bg-[#101318] shadow-[0_8px_18px_rgba(16,19,24,0.22)] transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ width: itemWidth, transform: `translateX(${activeIndex * 100}%)` }}
        />
      </span>
      {items.map((child) => (isValidElement(child) ? cloneElement(child) : child))}
    </div>
  )
}

function Stars({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((item) => (
        <Star
          key={item}
          className={item <= score ? "h-3 w-3 fill-amber-400 text-amber-400" : "h-3 w-3 text-[#d0d5dd]"}
        />
      ))}
    </span>
  )
}

function CrawlCompletenessStrip({ runs }: { runs: SourceCrawlRun[] }) {
  if (!runs.length) {
    return <span className="text-xs text-[#667085]">今日抓取完整性：暂无记录</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-[#667085]">今日抓取</span>
      {runs.map((run) => (
        <span
          key={`${run.source_key}-${run.id}`}
          className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium", statusClass(run.completeness_status))}
          title={run.error_pages.length ? run.error_pages.join("\n") : run.message}
        >
          {sourceLabel(run.source_key)}
          <b>{statusText(run.completeness_status)}</b>
          <span>{run.fetched_pages.length}/{run.expected_total_pages ?? "?"}页</span>
          <span>{run.fetched_count}条</span>
        </span>
      ))}
    </div>
  )
}

function AnnouncementRow({
  item,
  active,
  onClick,
}: {
  item: Announcement
  active: boolean
  onClick: () => void
}) {
  const tags = parseTags(item.agent_tags)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_104px] gap-3 border-b border-[#eef1f5] px-4 py-3 text-left transition-colors",
        active ? "bg-[#eef4ff]" : "bg-white hover:bg-[#f8fafc]",
      )}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{sourceLabel(item.source_key)}</Badge>
          {item.engineering_type ? <Badge variant="outline">{item.engineering_type}</Badge> : null}
          {item.detail_fetched ? (
            <span className="inline-flex items-center gap-1 text-xs text-[#475467]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              详情
            </span>
          ) : null}
        </span>
        <strong className="mt-2 block line-clamp-2 text-sm font-semibold leading-5 text-[#101318]">{item.title}</strong>
        <span className="mt-1 grid gap-x-3 gap-y-1 text-xs text-[#667085]">
          <span className="truncate">项目：{item.project_name || item.bid_section_name || "未披露"}</span>
          <span className="truncate">招标人：{item.tenderer || "未披露"}</span>
        </span>
        {item.agent_summary ? <span className="mt-2 block line-clamp-1 text-xs text-[#344054]">{item.agent_summary}</span> : null}
        {tags.length ? (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline">{tag}</Badge>
            ))}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col items-end justify-between gap-2">
        <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", scoreClass(item.opportunity_score))}>
          {scoreLabel(item.opportunity_score)}
        </span>
        <Stars score={item.opportunity_score} />
        <span className="text-xs text-[#667085]">发布 {formatDate(item.publish_time)}</span>
        <span className="text-xs text-[#667085]">截止 {formatDate(item.bid_deadline)}</span>
      </span>
    </button>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-sm text-[#667085]">
      <FileSearch className="mb-2 h-10 w-10 text-[#d0d5dd]" />
      {text}
    </div>
  )
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#e4e7ec] bg-white p-3">
      <p className="text-xs text-[#667085]">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-[#101318]">{value}</p>
    </div>
  )
}

function DetailPane({ item }: { item: Announcement | null }) {
  const [detail, setDetail] = useState("")
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailHeight, setDetailHeight] = useState(760)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const fitDetailFrame = useCallback(() => {
    const frame = iframeRef.current
    const doc = frame?.contentDocument
    if (!doc) return
    const body = doc.body
    const html = doc.documentElement
    const nextHeight = Math.max(
      760,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
      html?.scrollHeight ?? 0,
      html?.offsetHeight ?? 0,
    )
    setDetailHeight(nextHeight + 24)
  }, [])

  useEffect(() => {
    if (!item) {
      setDetail("")
      setDetailHeight(760)
      return
    }
    setDetail(item.detail_content || "")
    setDetailHeight(760)
    if (item.detail_fetched) return

    let mounted = true
    setLoadingDetail(true)
    fetchAnnouncementDetail(item.id)
      .then((next) => {
        if (mounted) setDetail(next.detail_content || "")
      })
      .finally(() => {
        if (mounted) setLoadingDetail(false)
      })
    return () => {
      mounted = false
    }
  }, [item])

  if (!item) {
    return (
      <aside className="flex h-full min-h-0 flex-col rounded-lg border border-[#e4e7ec] bg-white">
        <EmptyState text="从左侧公告列表选择一条公告" />
      </aside>
    )
  }

  const tags = parseTags(item.agent_tags)

  return (
    <aside className="h-full min-h-0 overflow-y-auto rounded-lg border border-[#e4e7ec] bg-white">
      <section className="border-b border-[#e4e7ec] p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{sourceLabel(item.source_key)}</Badge>
              <span className={cn("rounded-full px-2 py-1 text-xs font-semibold", scoreClass(item.opportunity_score))}>
                {scoreLabel(item.opportunity_score)}
              </span>
              {item.engineering_type ? <Badge variant="outline">{item.engineering_type}</Badge> : null}
            </div>
            <h2 className="mt-3 line-clamp-3 text-base font-semibold leading-6 text-[#101318]">{item.title}</h2>
            <p className="mt-2 text-xs text-[#667085]">公告号：{item.project_code || "未披露"}</p>
          </div>
          <Button variant="outline" size="icon" asChild>
            <a href={item.url} target="_blank" rel="noreferrer" title="查看原文">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <DetailMetric label="发布时间" value={formatDateTime(item.publish_time)} />
          <DetailMetric label="投标截止" value={formatDateTime(item.bid_deadline)} />
          <DetailMetric label="项目" value={item.project_name || item.bid_section_name || "未披露"} />
          <DetailMetric label="招标人" value={item.tenderer || "未披露"} />
        </div>
      </section>

      <section className="border-b border-[#e4e7ec] bg-[#f8fafc] p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[#101318]">Agent 研判</h3>
          <span className="text-xs text-[#667085]">
            置信度 {item.agent_confidence ? `${(item.agent_confidence * 100).toFixed(0)}%` : "未披露"}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-[#344054]">{item.agent_summary || "暂无研判摘要，建议补跑 Agent。"}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {item.agent_action ? <Badge variant="warning">{item.agent_action}</Badge> : null}
          {tags.map((tag) => (
            <Badge key={tag} variant="outline">{tag}</Badge>
          ))}
        </div>
      </section>

      <section>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e4e7ec] bg-white/95 px-4 py-3 backdrop-blur">
          <div>
            <h3 className="text-sm font-semibold text-[#101318]">公告详情</h3>
            <p className="text-xs text-[#667085]">预览公开公告内容</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href={item.url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              原文
            </a>
          </Button>
        </div>
        <div className="bg-[#f8fafc]">
          {loadingDetail ? (
            <div className="flex min-h-[520px] items-center justify-center text-sm text-[#667085]">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              正在抓取公告详情
            </div>
          ) : detail ? (
            <iframe
              ref={iframeRef}
              className="w-full border-0 bg-white"
              style={{ height: detailHeight }}
              srcDoc={detail}
              sandbox="allow-same-origin"
              scrolling="no"
              onLoad={() => {
                fitDetailFrame()
                window.setTimeout(fitDetailFrame, 250)
                window.setTimeout(fitDetailFrame, 1000)
              }}
            />
          ) : (
            <EmptyState text="暂无详情内容" />
          )}
        </div>
      </section>
    </aside>
  )
}

export default function App() {
  const [items, setItems] = useState<Announcement[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [crawling, setCrawling] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [search, setSearch] = useState("")
  const [activeSearch, setActiveSearch] = useState("")
  const [sourceKey, setSourceKey] = useState("")
  const [days, setDays] = useState(15)
  const [view, setView] = useState<ViewMode>("focus")
  const [engineering, setEngineering] = useState("")
  const [status, setStatus] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [crawlRuns, setCrawlRuns] = useState<SourceCrawlRun[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAnnouncements({
        limit: 1000,
        search: activeSearch,
        source_key: sourceKey,
        days,
        engineering,
        sort_by: "opportunity_score",
        sort_order: "desc",
      })
      setItems(data.items)
      setTotal(data.total)
      setSelectedId((current) => current ?? data.items[0]?.id ?? null)
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message : "后端服务暂不可用"
      setStatus(`加载失败：${message}`)
    } finally {
      setLoading(false)
    }
  }, [activeSearch, days, engineering, sourceKey])

  const loadCrawlRuns = useCallback(async () => {
    try {
      setCrawlRuns(await fetchLatestCrawlRuns())
    } catch {
      setCrawlRuns([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadCrawlRuns()
  }, [loadCrawlRuns])

  const visibleItems = useMemo(() => {
    if (view === "focus") return items.filter((item) => item.opportunity_score >= 3)
    if (view === "rules") return items.filter((item) => item.agent_stage === "rule")
    return items
  }, [items, view])

  const selected = visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0] ?? null
  const focusCount = items.filter((item) => item.opportunity_score >= 3).length
  const ruleCount = items.filter((item) => item.agent_stage === "rule").length

  const runSearch = () => {
    setActiveSearch(search.trim())
    setSelectedId(null)
  }

  const handleCrawl = async () => {
    setCrawling(true)
    setStatus("正在启动抓取任务。")
    try {
      let job = await startCrawlJob()
      setStatus(job.running ? "抓取已启动，公告列表会自动刷新。" : "已有抓取任务正在运行。")
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await sleep(2000)
        job = await fetchCrawlStatus()
        if (attempt % 3 === 0) await load()
        if (!job.running) {
          if (job.phase === "failed") {
            setStatus(`抓取失败：${job.error || "未知错误"}`)
          } else if (job.result) {
            setStatus(`抓取完成：新增 ${job.result.inserted_count} 条，详情 ${job.result.detail_fetched_count} 条。`)
            await loadCrawlRuns()
          } else {
            setStatus("抓取任务已结束。")
          }
          break
        }
        setStatus(`抓取运行中：${job.phase || "running"}`)
      }
      await load()
      await loadCrawlRuns()
    } catch (error) {
      setStatus(`抓取失败：${error instanceof Error ? error.message : "未知错误"}`)
    } finally {
      setCrawling(false)
    }
  }

  const handleAnalyze = async () => {
    setAnalyzing(true)
    setStatus("正在补跑 Agent。")
    try {
      const result = await triggerAgentAnalysis(80, { fetchDetails: true })
      setStatus(`Agent 完成：补抓详情 ${result.detail_fetched ?? 0} 条，研判 ${result.analyzed} 条。`)
      await load()
    } catch (error) {
      setStatus(`Agent 分析失败：${error instanceof Error ? error.message : "未知错误"}`)
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <main className="h-screen overflow-hidden bg-[#f4f5f7] text-[#101318]">
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="border-b border-[#e4e7ec] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(16,19,24,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">招标信息聚合</h1>
              <p className="mt-1 text-sm text-[#667085]">筛选公开招标公告，识别需要跟进的项目机会。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" asChild>
                <a href={CONFIG_URL}>
                  <Settings className="h-4 w-4" />
                  设置
                </a>
              </Button>
              <Button variant="outline" onClick={handleAnalyze} disabled={analyzing || crawling}>
                {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                补跑 Agent
              </Button>
              <Button onClick={handleCrawl} disabled={crawling || analyzing}>
                {crawling ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                立即抓取
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 xl:grid-cols-[auto_auto_minmax(280px,1fr)] xl:items-center">
            <SegmentGroup>
              <SegmentButton active={view === "focus"} onClick={() => setView("focus")}>
                重点 {focusCount}
              </SegmentButton>
              <SegmentButton active={view === "rules"} onClick={() => setView("rules")}>
                规则 {ruleCount}
              </SegmentButton>
              <SegmentButton active={view === "all"} onClick={() => setView("all")}>
                全部 {total}
              </SegmentButton>
            </SegmentGroup>

            <SegmentGroup>
              {DAY_OPTIONS.map((option) => (
                <SegmentButton
                  key={option.value}
                  active={days === option.value}
                  onClick={() => {
                    setDays(option.value)
                    setSelectedId(null)
                  }}
                >
                  {option.label}
                </SegmentButton>
              ))}
            </SegmentGroup>

            <div className="flex min-w-0 gap-2">
              <SegmentGroup className="hidden shrink-0 sm:inline-grid">
                {SOURCES.map((source) => (
                  <SegmentButton
                    key={source.value}
                    active={sourceKey === source.value}
                    onClick={() => {
                      setSourceKey(source.value)
                      setSelectedId(null)
                    }}
                  >
                    {source.label}
                  </SegmentButton>
                ))}
              </SegmentGroup>
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98a2b3]" />
                <Input
                  className="pl-9"
                  placeholder="搜索项目 / 招标人 / 标段"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") runSearch()
                  }}
                />
              </div>
              <Button variant="outline" size="icon" onClick={runSearch} title="搜索">
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <CrawlCompletenessStrip runs={crawlRuns} />
            {status ? (
              <div className="flex max-w-full items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                <span className="truncate">{status}</span>
                <button type="button" onClick={() => setStatus("")} title="关闭">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <section className="grid min-h-0 grid-cols-[minmax(420px,38%)_minmax(0,1fr)] gap-4 p-4">
          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#e4e7ec] bg-white">
            <div className="border-b border-[#e4e7ec] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">公告列表</h2>
                  <p className="mt-1 text-xs text-[#667085]">匹配 {visibleItems.length} 条，列表独立滚动</p>
                </div>
                {loading ? <Loader2 className="h-4 w-4 animate-spin text-[#667085]" /> : null}
              </div>
              <SegmentGroup className="mt-3 max-w-full overflow-x-auto">
                {ENGINEERING_TYPES.map((type) => {
                  const value = type === "全部" ? "" : type
                  return (
                    <SegmentButton
                      key={type}
                      active={engineering === value}
                      onClick={() => {
                        setEngineering(value)
                        setSelectedId(null)
                      }}
                    >
                      {type}
                    </SegmentButton>
                  )
                })}
              </SegmentGroup>
            </div>
            <div className="min-h-0 overflow-y-auto">
              {loading ? (
                <div className="flex h-full items-center justify-center text-sm text-[#667085]">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  正在加载公告
                </div>
              ) : visibleItems.length === 0 ? (
                <EmptyState text="暂无匹配公告" />
              ) : (
                visibleItems.map((item) => (
                  <AnnouncementRow
                    key={item.id}
                    item={item}
                    active={selected?.id === item.id}
                    onClick={() => setSelectedId(item.id)}
                  />
                ))
              )}
            </div>
          </div>

          <DetailPane item={selected} />
        </section>
      </div>
    </main>
  )
}
