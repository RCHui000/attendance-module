import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, FileDown, FileSearch, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, RefreshBadge, SkeletonBlock } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import {
  buildAnalysisEntities,
  getAnalysisEntityParam,
  getAnalysisViewLabel,
  type AnalysisBreakdownItem,
  type AnalysisEntity,
  type AnalysisView,
} from "@/components/dashboard/analysisModel";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import type { PeriodType } from "@/components/dashboard/periodUtils";
import { SegmentedPill } from "@/components/ui/segmented-pill";
import { useDashboardAnalysis } from "@/hooks/useProjects";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/utils/dates";
import type {
  DashboardAnalysisGrain,
  DashboardAnalysisSort,
  DashboardAnalysisSource,
} from "@/types/project";

interface DashboardAnalysisWorkbenchProps {
  startDate: string;
  endDate: string;
  periodType?: PeriodType;
  year?: number;
  month?: number;
  quarter?: number;
  weekStart?: string;
  onPeriodTypeChange?: (type: PeriodType) => void;
  onYearChange?: (year: number) => void;
  onMonthChange?: (month: number) => void;
  onQuarterChange?: (quarter: number) => void;
  onWeekStartChange?: (weekStart: string) => void;
}

const CHART_COLORS = [
  "#3b82f6",
  "#14b8a6",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#64748b",
  "#22c55e",
  "#0ea5e9",
];

const SORT_LONG_LABELS: Record<DashboardAnalysisSort, string> = {
  labor_days: "实际工日",
  labor_days_used_ratio: "消耗占比",
  labor_cost: "人力成本",
  labor_days_delta: "环比/关联",
};

const SORT_OPTIONS: { value: DashboardAnalysisSort; label: string }[] = [
  { value: "labor_days", label: "工日" },
  { value: "labor_days_used_ratio", label: "消耗" },
  { value: "labor_cost", label: "成本" },
  { value: "labor_days_delta", label: "环比" },
];

const VIEW_OPTIONS: { value: AnalysisView; label: string }[] = [
  { value: "project", label: "项目" },
  { value: "employee", label: "人员" },
  { value: "department", label: "部门" },
];

function percentLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "未设";
  return `${(value * 100).toFixed(1)}%`;
}

function compactMoney(value: number) {
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return formatMoney(value);
}

function ratioWidth(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "0%";
  return `${Math.min(Math.max(value * 100, 2), 100)}%`;
}

function metricTone(value: number) {
  if (value > 0) return "text-warning";
  if (value < 0) return "text-success";
  return "text-muted-foreground";
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-float ring-1 ring-foreground/10">
      {label && <p className="mb-1 font-semibold">{label}</p>}
      <div className="space-y-1">
        {payload.map((entry, index) => (
          <div key={`${entry.name}-${index}`} className="flex min-w-40 items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className="size-2 rounded-full" style={{ backgroundColor: entry.color || CHART_COLORS[index % CHART_COLORS.length] }} />
              <span className="truncate">{entry.name}</span>
            </span>
            <span className="font-medium tabular-nums">{Number(entry.value || 0).toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function filteredEntities(entities: AnalysisEntity[], query: string, sort: DashboardAnalysisSort) {
  const normalized = query.trim().toLowerCase();
  return [...entities]
    .filter((entity) => !normalized || entity.searchText.includes(normalized))
    .sort((a, b) => b.sortValues[sort] - a.sortValues[sort] || a.title.localeCompare(b.title));
}

function EntityRail({
  view,
  entities,
  selectedId,
  sort,
  query,
  onSortChange,
  onQueryChange,
  onSelect,
}: {
  view: AnalysisView;
  entities: AnalysisEntity[];
  selectedId: string | null;
  sort: DashboardAnalysisSort;
  query: string;
  onSortChange: (sort: DashboardAnalysisSort) => void;
  onQueryChange: (query: string) => void;
  onSelect: (entityId: string) => void;
}) {
  const label = getAnalysisViewLabel(view);

  return (
    <Card className="min-h-[680px] rounded-lg p-0">
      <div className="space-y-3 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">{label}排行</h2>
            <p className="text-xs text-muted-foreground">按{SORT_LONG_LABELS[sort]}排序</p>
          </div>
          <Badge variant="secondary">{entities.length}</Badge>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label={`搜索${label}`}
            name="dashboard-analysis-search"
            autoComplete="off"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={`搜索${label}…`}
            className="h-8 rounded-full pl-8 pr-8"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="清空搜索"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full"
              onClick={() => onQueryChange("")}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="max-w-full overflow-x-auto pb-1">
          <SegmentedPill
            value={sort}
            items={SORT_OPTIONS}
            onChange={onSortChange}
            ariaLabel={`${label}排行排序`}
          />
        </div>
      </div>
      <div className="max-h-[740px] overflow-y-auto p-2">
        {entities.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-10 text-center text-sm text-muted-foreground">
            没有匹配{label}
          </div>
        ) : (
          entities.map((entity, index) => {
            const active = selectedId === entity.id;
            return (
              <button
                key={`${entity.view}-${entity.id}`}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(entity.id)}
                className={cn(
                  "mb-2 w-full rounded-md border border-border bg-background px-3 py-3 text-left transition-[background-color,border-color,box-shadow] duration-150 hover:border-primary/40 hover:bg-row-hover",
                  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
                  active && "border-primary/60 bg-row-selected shadow-sm",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground tabular-nums">#{index + 1}</span>
                      <span className="truncate text-sm font-semibold">{entity.title}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{entity.badge || entity.subtitle}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums">{entity.labor_days.toFixed(1)}</p>
                    <p className="text-[11px] text-muted-foreground">工日</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                  <span>{entity.people_count} 人</span>
                  <span>{percentLabel(entity.labor_days_used_ratio)}</span>
                  <span className={cn("text-right tabular-nums", metricTone(entity.labor_days_delta))}>
                    {entity.labor_days_delta > 0 ? "+" : ""}
                    {entity.labor_days_delta.toFixed(1)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </Card>
  );
}

function BudgetStrip({ entity }: { entity: AnalysisEntity }) {
  const items =
    entity.view === "project"
      ? [
          {
            label: "计划工日消耗",
            value: percentLabel(entity.labor_days_used_ratio),
            width: ratioWidth(entity.labor_days_used_ratio),
            hint: `${entity.labor_days.toFixed(1)} / ${entity.planned_labor_days || 0} 工日`,
          },
          {
            label: "人力预算消耗",
            value: percentLabel(entity.labor_budget_used_ratio),
            width: ratioWidth(entity.labor_budget_used_ratio),
            hint: `${formatMoney(entity.labor_cost)} / ${formatMoney(entity.labor_budget_amount || 0)}`,
          },
          {
            label: "合同额人力占比",
            value: percentLabel(entity.labor_cost_contract_ratio),
            width: ratioWidth(entity.labor_cost_contract_ratio),
            hint: `${formatMoney(entity.labor_cost)} / ${formatMoney(entity.contract_amount || 0)}`,
          },
        ]
      : [
          {
            label: "期间工日占比",
            value: percentLabel(entity.labor_days_used_ratio),
            width: ratioWidth(entity.labor_days_used_ratio),
            hint: `${entity.labor_days.toFixed(1)} 工日`,
          },
          {
            label: "人力成本",
            value: compactMoney(entity.labor_cost),
            width: "100%",
            hint: `${entity.timesheet_count} 份来源周表`,
          },
          {
            label: entity.view === "employee" ? "参与项目" : "投入人员",
            value: String(entity.view === "employee" ? entity.project_count : entity.people_count),
            width: "100%",
            hint: entity.view === "employee" ? `${entity.department_count} 个相关部门` : `${entity.project_count} 个相关项目`,
          },
        ];

  return (
    <div className="grid grid-cols-3 gap-3 max-[1180px]:grid-cols-1">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{item.label}</span>
            <strong className="text-sm tabular-nums">{item.value}</strong>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-background ring-1 ring-border">
            <div className="h-full rounded-full bg-primary" style={{ width: item.width }} />
          </div>
          <p className="mt-2 truncate text-xs text-muted-foreground">{item.hint}</p>
        </div>
      ))}
    </div>
  );
}

function TrendPanel({ entity }: { entity: AnalysisEntity }) {
  const chartData = entity.trend.map((item) => ({
    bucket: item.bucket_label,
    工日: Number(item.labor_days || 0),
    人力成本: Number(item.labor_cost || 0),
  }));

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-app">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">投入趋势</h3>
          <p className="text-xs text-muted-foreground">按当前粒度展示{getAnalysisViewLabel(entity.view)}工日变化</p>
        </div>
      </div>
      {chartData.length === 0 ? (
        <EmptyState
          title={`当前${getAnalysisViewLabel(entity.view)}暂无趋势数据`}
          description="切换周期或选择其他对象后再查看趋势。"
          className="h-[250px]"
        />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`dashboardTrendFill-${entity.view}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-chart-primary)" stopOpacity={0.5} />
                <stop offset="95%" stopColor="var(--color-chart-primary)" stopOpacity={0.12} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-chart-grid)" strokeOpacity={0.75} />
            <XAxis
              dataKey="bucket"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--color-chart-axis)", fontWeight: 500 }}
            />
            <YAxis
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={36}
              tick={{ fill: "var(--color-chart-axis)", fontWeight: 500 }}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              dataKey="工日"
              stroke="var(--color-chart-primary)"
              fill={`url(#dashboardTrendFill-${entity.view})`}
              strokeWidth={2.75}
              type="monotone"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function DonutPanel({ title, description, items }: { title: string; description: string; items: AnalysisBreakdownItem[] }) {
  const donutData = items.slice(0, 8).map((item) => ({
    name: item.name,
    value: Number(item.labor_days || 0),
  }));

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-app">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {donutData.length === 0 ? (
        <EmptyState title="暂无结构拆分" description="当前对象还没有可用于占比分析的工时。" className="h-[260px]" />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_170px] gap-3 max-[1180px]:grid-cols-1">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={donutData}
                dataKey="value"
                nameKey="name"
                innerRadius={62}
                outerRadius={102}
                paddingAngle={3}
                cornerRadius={8}
                stroke="var(--color-card)"
                strokeWidth={3}
              >
                {donutData.map((item, index) => (
                  <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="self-center space-y-2">
            {donutData.map((item, index) => (
              <div key={item.name} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{item.value.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LoadPanel({ entity }: { entity: AnalysisEntity }) {
  const isEmployeeView = entity.view === "employee";
  const items: AnalysisBreakdownItem[] = isEmployeeView
    ? entity.projects
    : entity.employees.map((employee) => ({
        id: String(employee.employee_id),
        name: employee.employee_name,
        meta: employee.department,
        labor_days: employee.labor_days,
        labor_cost: employee.labor_cost,
        project_count: employee.project_count,
      }));
  const chartRows = items.slice(0, 8);
  const maxLaborDays = Math.max(...chartRows.map((item) => Number(item.labor_days || 0)), 1);

  return (
    <Card className="rounded-lg p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{isEmployeeView ? "项目分布" : "人员负荷"}</h3>
        <p className="text-xs text-muted-foreground">{isEmployeeView ? "该人员投入到哪些项目" : "谁投入最多，是否集中在少数人员"}</p>
      </div>
      {chartRows.length === 0 ? (
        <EmptyState title="暂无投入数据" description="当前对象还没有人员或项目投入记录。" className="h-[300px]" />
      ) : (
        <div className="rounded-md border border-border/70 bg-muted/10 px-3 py-3">
          <div className="space-y-3">
            {chartRows.map((item) => {
              const value = Number(item.labor_days || 0);
              const width = `${Math.max((value / maxLaborDays) * 100, value > 0 ? 8 : 0)}%`;
              return (
                <div
                  key={item.id}
                  className={cn(
                    "grid items-center gap-3",
                    isEmployeeView
                      ? "grid-cols-[minmax(7.5rem,10rem)_minmax(0,1fr)_3.5rem]"
                      : "grid-cols-[4.25rem_minmax(0,1fr)_3.5rem]",
                  )}
                >
                  <span className="min-w-0 truncate text-xs font-medium text-foreground" title={item.name}>
                    {item.name || "未命名"}
                  </span>
                  <div className="relative h-3 overflow-hidden rounded-full bg-muted ring-1 ring-border/70">
                    <div
                      className="h-full rounded-full bg-primary ring-1 ring-primary/10"
                      style={{ width }}
                    />
                  </div>
                  <span className="text-right text-xs text-muted-foreground tabular-nums">{value.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex justify-between border-t border-border/70 pt-2 text-[11px] text-muted-foreground tabular-nums">
            <span>0</span>
            <span>{(maxLaborDays / 2).toFixed(maxLaborDays >= 10 ? 0 : 1)}</span>
            <span>{maxLaborDays.toFixed(maxLaborDays >= 10 ? 0 : 1)} 工日</span>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {items.slice(0, 5).map((item) => (
          <div
            key={item.id}
            className={cn(
              "grid items-center gap-3 rounded-md bg-muted/30 px-3 py-2 text-xs",
              isEmployeeView ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-[4em_minmax(0,1fr)_auto]",
            )}
          >
            <span className="min-w-0 truncate font-medium" title={item.name}>
              {item.name}
            </span>
            {!isEmployeeView && (
              <span className="min-w-0 truncate text-muted-foreground" title={item.meta}>
                {item.meta || "—"}
              </span>
            )}
            <span className="shrink-0 tabular-nums">{item.labor_days.toFixed(1)} 工日</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SourceTable({ sources }: { sources: DashboardAnalysisSource[] }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-app">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">来源周表</h3>
          <p className="text-xs text-muted-foreground">项目 → 部门 → 人员 → 周表来源</p>
        </div>
        <Badge variant="outline">{sources.length} 条</Badge>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-table-header">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">项目</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">员工</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">部门</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">周表周期</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">工日</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">成本</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">状态</th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  暂无来源周表
                </td>
              </tr>
            ) : (
              sources.map((source) => (
                <tr key={`${source.timesheet_id}-${source.project_id}-${source.employee_id}`} className="border-b border-border/70 hover:bg-row-hover">
                  <td className="px-3 py-2">
                    <div className="max-w-[220px] truncate font-medium" title={source.project_name}>{source.project_name}</div>
                    <div className="text-xs text-muted-foreground">{source.project_code}</div>
                  </td>
                  <td className="px-3 py-2 font-medium">{source.employee_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{source.department}</td>
                  <td className="px-3 py-2 tabular-nums">{source.week_start_date}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{source.total_hours.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(source.labor_cost)}</td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary">{source.timesheet_status}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalysisWorkbenchSkeleton() {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-app">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-5 w-52" />
            <SkeletonBlock className="h-3 w-72 max-w-full" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-8 w-48 rounded-full" />
            <SkeletonBlock className="h-8 w-24 rounded-full" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[300px_minmax(0,1fr)_320px] gap-5 max-[1400px]:grid-cols-[280px_minmax(0,1fr)] max-[980px]:grid-cols-1">
        <div className="rounded-lg border border-border bg-card p-4 shadow-app">
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="mt-4 h-8 w-full rounded-full" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 7 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-20 w-full" />
            ))}
          </div>
        </div>
        <div className="space-y-5">
          <div className="rounded-lg border border-border bg-card p-4 shadow-app">
            <SkeletonBlock className="h-6 w-64" />
            <div className="mt-5 grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <SkeletonBlock key={index} className="h-24 w-full" />
              ))}
            </div>
          </div>
          <SkeletonBlock className="h-[300px] w-full rounded-lg" />
          <SkeletonBlock className="h-[300px] w-full rounded-lg" />
        </div>
        <div className="space-y-5 max-[1400px]:col-span-2 max-[980px]:col-span-1">
          <SkeletonBlock className="h-[420px] w-full rounded-lg" />
          <SkeletonBlock className="h-48 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function DashboardAnalysisWorkbench({
  startDate,
  endDate,
  periodType,
  year = new Date().getFullYear(),
  month = new Date().getMonth() + 1,
  quarter = Math.floor(new Date().getMonth() / 3) + 1,
  weekStart = startDate,
  onPeriodTypeChange,
  onYearChange,
  onMonthChange,
  onQuarterChange,
  onWeekStartChange,
}: DashboardAnalysisWorkbenchProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const grain: DashboardAnalysisGrain = periodType === "week" ? "week" : "month";
  const sortParam = searchParams.get("sort");
  const sort: DashboardAnalysisSort =
    sortParam === "labor_days_used_ratio" || sortParam === "labor_cost" || sortParam === "labor_days_delta"
      ? sortParam
      : "labor_days";
  const viewParam = searchParams.get("analysisView");
  const analysisView: AnalysisView =
    viewParam === "employee" || viewParam === "department" || viewParam === "project" ? viewParam : "project";
  const query = searchParams.get("q") || "";
  const selectedParam = searchParams.get(getAnalysisEntityParam(analysisView)) || "";
  const { data, isLoading, isFetching, isError } = useDashboardAnalysis(startDate, endDate, grain);

  const updateParams = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        Object.entries(updates).forEach(([key, value]) => {
          if (value) next.set(key, value);
          else next.delete(key);
        });
        return next;
      });
    },
    [setSearchParams],
  );

  const entities = useMemo(() => (data ? buildAnalysisEntities(data, analysisView) : []), [analysisView, data]);
  const filtered = useMemo(() => filteredEntities(entities, query, sort), [entities, query, sort]);
  const selectedEntity = useMemo(() => {
    return filtered.find((entity) => entity.id === selectedParam) || filtered[0] || null;
  }, [filtered, selectedParam]);
  const selectedEntityId = selectedEntity?.id ?? null;
  const structureItems = selectedEntity?.view === "project" ? selectedEntity.departments : selectedEntity?.projects || [];
  const structureTitle = selectedEntity?.view === "employee" ? "项目结构" : "投入结构";
  const structureDescription = selectedEntity?.view === "employee" ? "环状图用于解释该人员项目工日占比" : "环状图用于解释当前对象工日占比";

  const handleViewChange = useCallback(
    (nextView: AnalysisView) => {
      updateParams({
        analysisView: nextView,
        projectId: null,
        employeeId: null,
        department: null,
        q: null,
      });
    },
    [updateParams],
  );

  const handleExport = useCallback(() => {
    if (!selectedEntity) return;
    const rows = [
      "分析视角,分析对象,项目编号,项目名称,员工,部门,周表周期,工日,人力成本,周表状态",
      ...selectedEntity.sources.map((source) => [
        getAnalysisViewLabel(selectedEntity.view),
        `"${selectedEntity.title}"`,
        source.project_code,
        `"${source.project_name}"`,
        `"${source.employee_name}"`,
        `"${source.department}"`,
        source.week_start_date,
        source.total_hours.toFixed(1),
        source.labor_cost.toFixed(2),
        source.timesheet_status,
      ].join(",")),
    ];
    const blob = new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dashboard-analysis-${selectedEntity.view}-${selectedEntity.id}-${startDate}-${endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [endDate, selectedEntity, startDate]);

  if (isLoading && !data) {
    return <AnalysisWorkbenchSkeleton />;
  }

  if (isError && !data) {
    return <ErrorState title="分析数据加载失败" description="请稍后重试，或切换时间范围后再查看。" className="h-[420px]" />;
  }

  if (!data) return null;

  return (
    <div className="space-y-5">
      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          分析数据刷新失败，当前显示的是上一次可用数据。
        </div>
      )}
      <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-app">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold">分析台</h2>
              <SegmentedPill
                value={analysisView}
                items={VIEW_OPTIONS}
                onChange={handleViewChange}
                ariaLabel="分析视角"
              />
              <RefreshBadge show={isFetching} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {startDate} ~ {endDate} · {data.summary.project_count} 个项目 · {data.summary.employee_count} 名人员 · {data.summary.labor_days.toFixed(1)} 工日
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {periodType && onPeriodTypeChange && onYearChange && onMonthChange && onQuarterChange ? (
              <PeriodFilter
                periodType={periodType}
                year={year}
                month={month}
                quarter={quarter}
                weekStart={weekStart}
                onPeriodTypeChange={onPeriodTypeChange}
                onYearChange={onYearChange}
                onMonthChange={onMonthChange}
                onQuarterChange={onQuarterChange}
                onWeekStartChange={onWeekStartChange}
              />
            ) : null}
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={handleExport} disabled={!selectedEntity}>
              <FileDown className="mr-1.5 size-3.5" aria-hidden="true" />
              导出分析
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[300px_minmax(0,1fr)_320px] gap-5 max-[1400px]:grid-cols-[280px_minmax(0,1fr)] max-[980px]:grid-cols-1">
        <EntityRail
          view={analysisView}
          entities={filtered}
          selectedId={selectedEntityId}
          sort={sort}
          query={query}
          onSortChange={(value) => updateParams({ sort: value, [getAnalysisEntityParam(analysisView)]: null })}
          onQueryChange={(value) => updateParams({ q: value, [getAnalysisEntityParam(analysisView)]: null })}
          onSelect={(entityId) => updateParams({ [getAnalysisEntityParam(analysisView)]: entityId })}
        />

        <div className="min-w-0 space-y-5">
          {selectedEntity ? (
            <>
              <Card className="rounded-lg p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-semibold">{selectedEntity.title}</h2>
                      {selectedEntity.badge && <Badge variant="outline">{selectedEntity.badge}</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedEntity.subtitle}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-right max-[720px]:w-full max-[720px]:grid-cols-1 max-[720px]:text-left">
                    <div>
                      <p className="text-xs text-muted-foreground">实际工日</p>
                      <strong className="text-xl tabular-nums">{selectedEntity.labor_days.toFixed(1)}</strong>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">人力成本</p>
                      <strong className="text-xl tabular-nums">{compactMoney(selectedEntity.labor_cost)}</strong>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{selectedEntity.view === "project" ? "环比工日" : "消耗占比"}</p>
                      <strong className={cn("inline-flex items-center gap-1 text-xl tabular-nums", metricTone(selectedEntity.labor_days_delta))}>
                        {selectedEntity.view === "project" ? (
                          <>
                            {selectedEntity.labor_days_delta >= 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                            {selectedEntity.labor_days_delta > 0 ? "+" : ""}
                            {selectedEntity.labor_days_delta.toFixed(1)}
                          </>
                        ) : (
                          percentLabel(selectedEntity.labor_days_used_ratio)
                        )}
                      </strong>
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <BudgetStrip entity={selectedEntity} />
                </div>
              </Card>
              <TrendPanel entity={selectedEntity} />
              <DonutPanel title={structureTitle} description={structureDescription} items={structureItems} />
            </>
          ) : (
            <Card className="flex h-[520px] items-center justify-center rounded-lg p-5 text-sm text-muted-foreground">
              选择一个{getAnalysisViewLabel(analysisView)}查看分析
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-5 max-[1400px]:col-span-2 max-[980px]:col-span-1">
          {selectedEntity && <LoadPanel entity={selectedEntity} />}
          <Card className="rounded-lg p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileSearch className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-semibold">解释线索</h3>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground">投入最高人员</span>
                <span className="min-w-0 truncate font-medium">
                  {selectedEntity?.employees[0] ? `${selectedEntity.employees[0].employee_name} · ${selectedEntity.employees[0].labor_days.toFixed(1)} 工日` : "暂无"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground">最大结构占比</span>
                <span className="min-w-0 truncate font-medium">
                  {structureItems[0] && selectedEntity
                    ? `${structureItems[0].name} · ${percentLabel(structureItems[0].labor_days / Math.max(selectedEntity.labor_days, 1))}`
                    : "暂无"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground">来源周表</span>
                <span className="font-medium tabular-nums">{selectedEntity?.sources.length || 0} 份</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <SourceTable sources={selectedEntity?.sources || []} />
    </div>
  );
}
