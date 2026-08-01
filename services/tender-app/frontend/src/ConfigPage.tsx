import { useCallback, useEffect, useState } from "react"
/* eslint-disable react-hooks/set-state-in-effect */
import { ArrowDown, ArrowLeft, ArrowUp, Bot, CircleDollarSign, Clock3, Database, KeyRound, Loader2, Plus, Save, Trash2 } from "lucide-react"

import {
  deleteSourceConfig,
  fetchAgentSettings,
  fetchBillingRuns,
  fetchBillingSummary,
  fetchCrawlSchedule,
  fetchSourceConfigs,
  saveAgentSettings,
  saveCrawlSchedule,
  saveSourceConfig,
  type SourceConfig,
} from "@/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PillSlider } from "@/components/ui/pill-slider"
import type { BillingRun, BillingSummary, CrawlScheduleSettings, ScheduleTask } from "@/types"

const ROOT_URL = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/")

const EMPTY_SOURCE: SourceConfig = {
  id: null,
  source_key: "",
  name: "",
  list_url: "",
  source_type: "shenzhen",
  enabled: true,
  created_at: null,
}

const DEFAULT_AGENT = {
  api_base: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  api_key: "",
  enabled: false,
}

const DEFAULT_SCHEDULE: CrawlScheduleSettings = {
  enabled: true,
  hour: 8,
  minute: 30,
  lookback_days: 3,
  action: "crawl_sources",
  tasks: [
    {
      id: "default-crawl",
      sort_order: 0,
      enabled: true,
      action: "crawl_sources",
      hour: 8,
      minute: 30,
      lookback_days: 3,
      agent_limit: 50,
      fetch_details: true,
      force: false,
    },
  ],
}

const BILLING_STATUS_LABEL: Record<string, string> = {
  running: "运行中",
  finished: "已完成",
  balance_unavailable: "余额不可用",
  balance_start_failed: "开始余额失败",
  balance_end_failed: "结束余额失败",
  failed: "任务失败",
}

type TabKey = "agent" | "sources" | "schedule"

export default function ConfigPage() {
  const [configs, setConfigs] = useState<SourceConfig[]>([])
  const [agent, setAgent] = useState(DEFAULT_AGENT)
  const [schedule, setSchedule] = useState<CrawlScheduleSettings>(DEFAULT_SCHEDULE)
  const [maskedKey, setMaskedKey] = useState("")
  const [tab, setTab] = useState<TabKey>("agent")
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [billingRuns, setBillingRuns] = useState<BillingRun[]>([])
  const [loading, setLoading] = useState(true)
  const [savingAgent, setSavingAgent] = useState(false)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [status, setStatus] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sourceConfigs, agentSettings, scheduleSettings, billingSummary, runs] = await Promise.all([
        fetchSourceConfigs(),
        fetchAgentSettings(),
        fetchCrawlSchedule(),
        fetchBillingSummary(),
        fetchBillingRuns(100),
      ])
      setConfigs(sourceConfigs)
      setAgent({ api_base: agentSettings.api_base, model: agentSettings.model, api_key: "", enabled: agentSettings.enabled })
      setSchedule(scheduleSettings)
      setMaskedKey(agentSettings.api_key_masked)
      setBilling(billingSummary)
      setBillingRuns(runs)
    } catch (error) {
      setStatus(`加载配置失败：${error instanceof Error ? error.message : "未知错误"}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const saveAgent = async () => {
    setSavingAgent(true)
    setStatus("正在保存 Agent 配置。")
    try {
      const saved = await saveAgentSettings({ ...agent, api_key: agent.api_key.trim() || "__KEEP__", enabled: agent.enabled })
      setAgent({ api_base: saved.api_base, model: saved.model, api_key: "", enabled: saved.enabled })
      setMaskedKey(saved.api_key_masked)
      setStatus("Agent 配置已保存。")
    } catch (error) {
      setStatus(`Agent 配置保存失败：${error instanceof Error ? error.message : "未知错误"}`)
    } finally {
      setSavingAgent(false)
    }
  }

  const clearAgentKey = async () => {
    setSavingAgent(true)
    setStatus("正在清除 Agent API Key。")
    try {
      const saved = await saveAgentSettings({ ...agent, api_key: "__CLEAR__", enabled: false })
      setAgent({ api_base: saved.api_base, model: saved.model, api_key: "", enabled: saved.enabled })
      setMaskedKey(saved.api_key_masked)
      setStatus("Agent API Key 已清除，LLM 精细分析已关闭。")
    } catch (error) {
      setStatus(`Agent API Key 清除失败：${error instanceof Error ? error.message : "未知错误"}`)
    } finally {
      setSavingAgent(false)
    }
  }

  const saveScheduleSettings = async () => {
    setSavingSchedule(true)
    setStatus("正在保存定时任务设置。")
    try {
      const normalizedTasks = scheduleTasks.map((task, index) => ({
        ...task,
        id: task.id || `task-${index + 1}`,
        sort_order: index,
        hour: Math.max(0, Math.min(23, Number(task.hour) || 0)),
        minute: Math.max(0, Math.min(59, Number(task.minute) || 0)),
        lookback_days: Math.max(1, Math.min(30, Number(task.lookback_days) || 1)),
        agent_limit: Math.max(1, Math.min(100, Number(task.agent_limit) || 50)),
        fetch_details: Boolean(task.fetch_details),
        force: Boolean(task.force),
      }))
      const firstCrawl = normalizedTasks.find((task) => task.action === "crawl_sources") ?? normalizedTasks[0]
      const saved = await saveCrawlSchedule({
        ...schedule,
        hour: firstCrawl?.hour ?? 8,
        minute: firstCrawl?.minute ?? 30,
        lookback_days: firstCrawl?.lookback_days ?? 3,
        action: firstCrawl?.action ?? "crawl_sources",
        tasks: normalizedTasks,
      })
      setSchedule(saved)
      setStatus("定时任务设置已保存。")
    } catch (error) {
      setStatus(`定时任务设置保存失败：${error instanceof Error ? error.message : "未知错误"}`)
    } finally {
      setSavingSchedule(false)
    }
  }

  const saveSource = async (index: number) => {
    const source = configs[index]
    if (!source.source_key.trim() || !source.name.trim() || !source.list_url.trim()) {
      setStatus("请填写数据源 key、名称和列表 URL。")
      return
    }
    try {
      const saved = await saveSourceConfig(source)
      setConfigs((current) => current.map((item, itemIndex) => (itemIndex === index ? saved : item)))
      setStatus(`已保存数据源：${saved.name}`)
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : "未知错误"}`)
    }
  }

  const removeSource = async (index: number) => {
    const source = configs[index]
    if (!source.id && !source.source_key) {
      setConfigs((current) => current.filter((_, itemIndex) => itemIndex !== index))
      return
    }
    try {
      await deleteSourceConfig(source.source_key)
      setConfigs((current) => current.filter((_, itemIndex) => itemIndex !== index))
      setStatus(`已删除数据源：${source.name}`)
    } catch (error) {
      setStatus(`删除失败：${error instanceof Error ? error.message : "未知错误"}`)
    }
  }

  const updateSource = (index: number, field: keyof SourceConfig, value: string | boolean) => {
    setConfigs((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item)))
  }

  const addScheduleTask = () => {
    setSchedule((current) => ({
      ...current,
      tasks: [
        ...(current.tasks || []),
        {
          id: `task-${Date.now()}`,
          sort_order: current.tasks?.length ?? 0,
          enabled: true,
          action: "crawl_sources",
          hour: 15,
          minute: 30,
          lookback_days: current.lookback_days || 3,
          agent_limit: 50,
          fetch_details: true,
          force: false,
        },
      ],
    }))
  }

  const updateScheduleTask = <K extends keyof ScheduleTask>(index: number, field: K, value: ScheduleTask[K]) => {
    setSchedule((current) => ({
      ...current,
      tasks: (current.tasks || []).map((task, taskIndex) => (taskIndex === index ? { ...task, [field]: value } : task)),
    }))
  }

  const removeScheduleTask = (index: number) => {
    setSchedule((current) => ({
      ...current,
      tasks: (current.tasks || []).filter((_, taskIndex) => taskIndex !== index).map((task, taskIndex) => ({ ...task, sort_order: taskIndex })),
    }))
  }

  const moveScheduleTask = (index: number, direction: -1 | 1) => {
    setSchedule((current) => {
      const tasks = [...(current.tasks || [])]
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= tasks.length) return current
      const [task] = tasks.splice(index, 1)
      tasks.splice(targetIndex, 0, task)
      return { ...current, tasks: tasks.map((item, itemIndex) => ({ ...item, sort_order: itemIndex })) }
    })
  }

  const scheduleTasks = (schedule.tasks?.length ? schedule.tasks : DEFAULT_SCHEDULE.tasks).map((task, index) => ({ ...task, sort_order: task.sort_order ?? index }))

  const fieldLabel = "text-xs font-medium text-[#667085]"
  const checkboxClass = "h-4 w-4 rounded border-[#d0d5dd] accent-[#111827]"
  const panelClass = "rounded-lg border border-[#e4e7ec] bg-white p-4"
  const billingStatusLabel = (value?: string) => value ? (BILLING_STATUS_LABEL[value] ?? value) : "暂无"

  return (
    <main className="min-h-screen bg-[#f4f5f7] text-[#101828]">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-5">
        <header className="mb-4 flex flex-col gap-3 border-b border-[#e4e7ec] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" asChild>
              <a href={ROOT_URL}><ArrowLeft className="h-4 w-4" /></a>
            </Button>
            <div>
              <h1 className="text-xl font-semibold text-[#101828]">系统设置</h1>
              <p className="mt-1 text-sm text-[#667085]">管理 Agent、数据源、定时抓取与费用统计。</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => setConfigs((current) => [...current, { ...EMPTY_SOURCE }])}>
            <Plus className="h-4 w-4" />添加数据源
          </Button>
        </header>

        {status ? <div className="mb-4 rounded-lg border border-[#b9c6d8] bg-white px-4 py-3 text-sm text-[#344054] shadow-sm">{status}</div> : null}

        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[#667085]"><Loader2 className="mr-2 h-5 w-5 animate-spin" />正在加载配置</div>
        ) : (
          <>
            <PillSlider
              className="mb-4"
              value={tab}
              onChange={(nextTab) => setTab(nextTab)}
              options={[
                { value: "agent", label: "Agent" },
                { value: "sources", label: "数据源" },
                { value: "schedule", label: "定时任务" },
              ]}
            />

            <div className="space-y-4">
              {tab === "agent" ? (
                <>
                  <Card className="rounded-lg">
                    <CardHeader><CardTitle className="flex items-center justify-between text-base"><span className="flex items-center gap-2"><Bot className="h-5 w-5 text-[#475467]" />Agent 精细分析</span><Badge variant={agent.enabled ? "default" : "secondary"}>{agent.enabled ? "已启用" : "未启用"}</Badge></CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1.5"><span className={fieldLabel}>API Base</span><Input value={agent.api_base} onChange={(event) => setAgent((current) => ({ ...current, api_base: event.target.value }))} /></label>
                        <label className="space-y-1.5"><span className={fieldLabel}>模型</span><Input value={agent.model} onChange={(event) => setAgent((current) => ({ ...current, model: event.target.value }))} /></label>
                        <label className="space-y-1.5 md:col-span-2"><span className={fieldLabel}>API Key</span><div className="relative"><KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98a2b3]" /><Input className="pl-9" type="password" value={agent.api_key} onChange={(event) => setAgent((current) => ({ ...current, api_key: event.target.value }))} placeholder={maskedKey ? `已保存：${maskedKey}，留空则保持不变` : "sk-..."} /></div></label>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e4e7ec] pt-4">
                        <label className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={agent.enabled} onChange={(event) => setAgent((current) => ({ ...current, enabled: event.target.checked }))} className={checkboxClass} />启用 LLM 精细分析</label>
                        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={clearAgentKey} disabled={savingAgent || !maskedKey}><Trash2 className="h-4 w-4" />清除 API Key</Button><Button onClick={saveAgent} disabled={savingAgent}>{savingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存 Agent</Button></div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="rounded-lg">
                    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CircleDollarSign className="h-5 w-5 text-[#475467]" />费用统计</CardTitle></CardHeader>
                    <CardContent>
                      <div className="grid gap-3 md:grid-cols-4"><div className={panelClass}><p className="text-xs text-[#667085]">累计费用</p><p className="mt-2 text-2xl font-semibold text-[#101828]">{(billing?.total_cost ?? 0).toFixed(4)} {billing?.currency || "CNY"}</p></div><div className={panelClass}><p className="text-xs text-[#667085]">有效计费</p><p className="mt-2 text-2xl font-semibold text-[#101828]">{billing?.priced_run_count ?? 0}</p></div><div className={panelClass}><p className="text-xs text-[#667085]">未计费/失败</p><p className="mt-2 text-2xl font-semibold text-[#101828]">{billing?.failed_run_count ?? 0}<span className="ml-2 text-xs font-normal text-[#667085]">总 {billing?.run_count ?? 0}</span></p></div><div className={panelClass}><p className="text-xs text-[#667085]">最近状态</p><p className="mt-2 text-sm font-semibold text-[#101828]">{billingStatusLabel(billing?.last_run?.status)}</p></div></div>
                      <div className="mt-4 overflow-hidden rounded-lg border border-[#e4e7ec]"><div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr] bg-[#f6f7f9] px-3 py-2 text-xs font-medium text-[#667085]"><span>时间</span><span>开始余额</span><span>结束余额</span><span>费用</span><span>状态</span></div><div className="max-h-[420px] overflow-y-auto">{billingRuns.length ? billingRuns.map((run) => (<div key={run.id ?? `${run.started_at}-${run.status}`} className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr] border-t border-[#e4e7ec] px-3 py-2 text-sm"><span className="truncate">{run.started_at}</span><span>{run.start_balance ?? "-"}</span><span>{run.end_balance ?? "-"}</span><span>{run.cost == null ? "-" : `${run.cost.toFixed(4)} ${run.currency || ""}`}</span><span className="truncate" title={run.error || run.status}>{billingStatusLabel(run.status)}</span></div>)) : (<div className="px-3 py-8 text-center text-sm text-[#667085]">暂无费用记录</div>)}</div></div>
                    </CardContent>
                  </Card>
                </>
              ) : null}

              {tab === "sources" ? (
                <Card className="rounded-lg">
                  <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Database className="h-5 w-5 text-[#475467]" />数据源</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    {configs.map((source, index) => (
                      <div key={`${source.id ?? "new"}-${index}`} className="rounded-lg border border-[#e4e7ec] bg-white p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-[#101828]">{source.name || "新数据源"}</strong><Badge variant={source.enabled ? "default" : "secondary"}>{source.enabled ? "启用" : "停用"}</Badge></div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input value={source.source_key} placeholder="source_key" onChange={(event) => updateSource(index, "source_key", event.target.value)} />
                          <Input value={source.name} placeholder="名称" onChange={(event) => updateSource(index, "name", event.target.value)} />
                          <Input className="md:col-span-2" value={source.list_url} placeholder="列表 URL" onChange={(event) => updateSource(index, "list_url", event.target.value)} />
                          <select className="h-9 rounded-full border border-[#d0d5dd] bg-white px-3 text-sm shadow-sm outline-none transition focus:ring-1 focus:ring-[#111827]" value={source.source_type} onChange={(event) => updateSource(index, "source_type", event.target.value)}><option value="shenzhen">深圳 JSON API</option><option value="beijing">北京 HTML 解析</option></select>
                          <label className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={source.enabled} onChange={(event) => updateSource(index, "enabled", event.target.checked)} className={checkboxClass} />启用每日抓取</label>
                        </div>
                        <div className="mt-3 flex justify-end gap-2 border-t border-[#e4e7ec] pt-3"><Button variant="ghost" size="sm" onClick={() => removeSource(index)}><Trash2 className="h-4 w-4" />删除</Button><Button size="sm" onClick={() => saveSource(index)}><Save className="h-4 w-4" />保存</Button></div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {tab === "schedule" ? (
                <Card className="rounded-lg">
                  <CardHeader><CardTitle className="flex items-center justify-between text-base"><span className="flex items-center gap-2"><Clock3 className="h-5 w-5 text-[#475467]" />定时任务</span><Badge variant={schedule.enabled ? "default" : "secondary"}>{schedule.enabled ? "已启用" : "已停用"}</Badge></CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm text-[#344054]"><input type="checkbox" checked={schedule.enabled} onChange={(event) => setSchedule((current) => ({ ...current, enabled: event.target.checked }))} className={checkboxClass} />启用定时任务</label>
                      <Button variant="outline" size="sm" onClick={addScheduleTask}><Plus className="h-4 w-4" />添加动作</Button>
                    </div>
                    <div className="space-y-3">
                      {scheduleTasks.map((task, index) => {
                        const timeValue = `${String(task.hour).padStart(2, "0")}:${String(task.minute).padStart(2, "0")}`
                        return (
                          <div key={task.id || index} className="rounded-lg border border-[#e4e7ec] bg-white p-4">
                            <div className="grid gap-3 lg:grid-cols-[128px_auto_1.4fr_150px_120px_120px_auto] lg:items-end">
                              <div className="space-y-1.5">
                                <span className={fieldLabel}>顺序</span>
                                <div className="flex h-9 items-center gap-1">
                                  <span className="min-w-6 text-sm font-semibold text-[#344054]">{index + 1}</span>
                                  <Button variant="ghost" size="icon" onClick={() => moveScheduleTask(index, -1)} disabled={index === 0} title="上移"><ArrowUp className="h-4 w-4" /></Button>
                                  <Button variant="ghost" size="icon" onClick={() => moveScheduleTask(index, 1)} disabled={index === scheduleTasks.length - 1} title="下移"><ArrowDown className="h-4 w-4" /></Button>
                                </div>
                              </div>
                              <label className="flex items-center gap-2 pb-2 text-sm text-[#344054] lg:pb-2.5"><input type="checkbox" checked={task.enabled} onChange={(event) => updateScheduleTask(index, "enabled", event.target.checked)} className={checkboxClass} />启用</label>
                              <label className="space-y-1.5"><span className={fieldLabel}>动作</span><select className="h-9 w-full rounded-full border border-[#d0d5dd] bg-white px-3 text-sm shadow-sm outline-none transition focus:ring-1 focus:ring-[#111827]" value={task.action} onChange={(event) => updateScheduleTask(index, "action", event.target.value as ScheduleTask["action"])}><option value="crawl_sources">基础信息抓取</option><option value="agent_analyze">Agent 分析</option></select></label>
                              <label className="space-y-1.5"><span className={fieldLabel}>执行时间</span><Input type="time" value={timeValue} onChange={(event) => { const [hour, minute] = event.target.value.split(":").map(Number); updateScheduleTask(index, "hour", Number.isFinite(hour) ? hour : 0); updateScheduleTask(index, "minute", Number.isFinite(minute) ? minute : 0) }} /></label>
                              {task.action === "crawl_sources" ? (
                                <label className="space-y-1.5"><span className={fieldLabel}>回看天数</span><Input type="number" min={1} max={30} value={task.lookback_days} onChange={(event) => updateScheduleTask(index, "lookback_days", Number(event.target.value))} /></label>
                              ) : (
                                <div className="space-y-1.5"><span className={fieldLabel}>分析范围</span><div className="flex h-9 items-center rounded-full border border-[#d0d5dd] bg-[#f6f7f9] px-3 text-sm text-[#475467]">全部待分析</div></div>
                              )}
                              {task.action === "agent_analyze" ? (
                                <label className="flex items-center gap-2 pb-2 text-sm text-[#344054] lg:pb-2.5"><input type="checkbox" checked={task.fetch_details} onChange={(event) => updateScheduleTask(index, "fetch_details", event.target.checked)} className={checkboxClass} />抓详情</label>
                              ) : <div />}
                              <Button variant="ghost" size="sm" onClick={() => removeScheduleTask(index)} disabled={scheduleTasks.length <= 1}><Trash2 className="h-4 w-4" />删除</Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="flex justify-end border-t border-[#e4e7ec] pt-4"><Button onClick={saveScheduleSettings} disabled={savingSchedule}>{savingSchedule ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}保存定时任务</Button></div>
                  </CardContent>
                </Card>
              ) : null}

            </div>
          </>
        )}
      </div>
    </main>
  )
}
