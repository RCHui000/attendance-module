import { useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, FileDown, FileSearch, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import type { PeriodType } from "@/components/dashboard/periodUtils";
import { SegmentedPill } from "@/components/ui/segmented-pill";
import { useDashboardAnalysis } from "@/hooks/useProjects";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/utils/dates";
import type {
  DashboardAnalysisData,
  DashboardAnalysisDepartment,
  DashboardAnalysisEmployee,
  DashboardAnalysisGrain,
  DashboardAnalysisProject,
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

const SORT_LABELS: Record<DashboardAnalysisSort, string> = {
  labor_days: "实际工日",
  labor_days_used_ratio: "计划消耗率",
  labor_cost: "人力成本",
  labor_days_delta: "环比变化",
};

const SORT_OPTIONS: { value: DashboardAnalysisSort; label: string }[] = [
  { value: "labor_days", label: "实际工日" },
  { value: "labor_days_used_ratio", label: "计划消耗率" },
  { value: "labor_cost", label: "人力成本" },
  { value: "labor_days_delta", label: "环比变化" },
];

function numberValue(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

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

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
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

function filteredProjects(data: DashboardAnalysisData, query: string, sort: DashboardAnalysisSort) {
  const normalized = query.trim().toLowerCase();
  return [...data.projects]
    .filter((project) => {
      if (!normalized) return true;
      return [project.project_code, project.project_name].some((value) =>
        String(value || "").toLowerCase().includes(normalized),
      );
    })
    .sort((a, b) => numberValue(b[sort]) - numberValue(a[sort]) || a.project_code.localeCompare(b.project_code));
}

function ProjectRail({
  projects,
  selectedId,
  sort,
  query,
  onSortChange,
  onQueryChange,
  onSelect,
}: {
  projects: DashboardAnalysisProject[];
  selectedId: number | null;
  sort: DashboardAnalysisSort;
  query: string;
  onSortChange: (sort: DashboardAnalysisSort) => void;
  onQueryChange: (query: string) => void;
  onSelect: (projectId: number) => void;
}) {
  return (
    <Card className="min-h-[680px] rounded-lg p-0">
      <div className="space-y-3 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">项目排行</h2>
            <p className="text-xs text-muted-foreground">按{SORT_LABELS[sort]}排序</p>
          </div>
          <Badge variant="secondary">{projects.length}</Badge>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="搜索项目"
            name="dashboard-analysis-search"
            autoComplete="off"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索项目…"
            className="h-8 rounded-full pl-8 pr-8"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="清空项目搜索"
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
            ariaLabel="项目排行排序"
          />
        </div>
      </div>
      <div className="max-h-[740px] overflow-y-auto p-2">
        {projects.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-10 text-center text-sm text-muted-foreground">
            没有匹配项目
          </div>
        ) : (
          projects.map((project, index) => {
            const active = selectedId === project.project_id;
            return (
              <button
                key={project.project_id}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(project.project_id)}
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
                      <span className="truncate text-sm font-semibold">{project.project_name}</span>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{project.project_code}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums">{project.labor_days.toFixed(1)}</p>
                    <p className="text-[11px] text-muted-foreground">工日</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                  <span>{project.people_count} 人</span>
                  <span>{percentLabel(project.labor_days_used_ratio)}</span>
                  <span className={cn("text-right tabular-nums", metricTone(project.labor_days_delta))}>
                    {project.labor_days_delta > 0 ? "+" : ""}
                    {project.labor_days_delta.toFixed(1)}
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

function BudgetStrip({ project }: { project: DashboardAnalysisProject }) {
  const items = [
    {
      label: "计划工日消耗",
      value: percentLabel(project.labor_days_used_ratio),
      width: ratioWidth(project.labor_days_used_ratio),
      hint: `${project.labor_days.toFixed(1)} / ${project.planned_labor_days || 0} 工日`,
    },
    {
      label: "人力预算消耗",
      value: percentLabel(project.labor_budget_used_ratio),
      width: ratioWidth(project.labor_budget_used_ratio),
      hint: `${formatMoney(project.labor_cost)} / ${formatMoney(project.labor_budget_amount || 0)}`,
    },
    {
      label: "合同额人力占比",
      value: percentLabel(project.labor_cost_contract_ratio),
      width: ratioWidth(project.labor_cost_contract_ratio),
      hint: `${formatMoney(project.labor_cost)} / ${formatMoney(project.contract_amount || 0)}`,
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

function TrendPanel({ trend }: { trend: DashboardAnalysisData["trend"] }) {
  const chartData = trend.map((item) => ({
    bucket: item.bucket_label,
    工日: Number(item.labor_days || 0),
    人力成本: Number(item.labor_cost || 0),
  }));

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-app">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">投入趋势</h3>
          <p className="text-xs text-muted-foreground">按当前粒度展示项目工日变化</p>
        </div>
      </div>
      {chartData.length === 0 ? (
        <div className="flex h-[250px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          当前项目暂无趋势数据
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="dashboardTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.24} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="bucket" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis fontSize={11} tickLine={false} axisLine={false} width={36} />
            <Tooltip content={<ChartTooltip />} />
            <Area dataKey="工日" stroke="hsl(var(--primary))" fill="url(#dashboardTrendFill)" strokeWidth={2} type="monotone" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function DonutPanel({ departments, employees }: { departments: DashboardAnalysisDepartment[]; employees: DashboardAnalysisEmployee[] }) {
  const donutData =
    departments.length > 0
      ? departments.slice(0, 8).map((item) => ({
          name: item.department,
          value: Number(item.labor_days || 0),
        }))
      : employees.slice(0, 8).map((item) => ({
          name: item.employee_name,
          value: Number(item.labor_days || 0),
        }));

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-app">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">投入结构</h3>
        <p className="text-xs text-muted-foreground">环状图用于解释当前项目工日占比</p>
      </div>
      {donutData.length === 0 ? (
        <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          暂无结构拆分
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-3 max-[1180px]:grid-cols-1">
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
                stroke="hsl(var(--card))"
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

function EmployeeLoadPanel({ employees }: { employees: DashboardAnalysisEmployee[] }) {
  const chartData = employees.slice(0, 12).map((employee) => ({
    name: employee.employee_name,
    工日: Number(employee.labor_days || 0),
    成本: Number(employee.labor_cost || 0),
    department: employee.department,
  })).reverse();

  return (
    <Card className="rounded-lg p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">人员负荷</h3>
        <p className="text-xs text-muted-foreground">谁投入最多，是否集中在少数人员</p>
      </div>
      {chartData.length === 0 ? (
        <div className="flex h-[320px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          暂无人员投入
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(320, chartData.length * 34)}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
            <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={76} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="工日" fill="#3b82f6" radius={[0, 6, 6, 0]} barSize={14} />
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className="mt-3 space-y-2">
        {employees.slice(0, 5).map((employee) => (
          <div key={employee.employee_id} className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2 text-xs">
            <span className="min-w-0 truncate">
              {employee.employee_name}
              <span className="ml-2 text-muted-foreground">{employee.department}</span>
            </span>
            <span className="shrink-0 tabular-nums">{employee.labor_days.toFixed(1)} 工日</span>
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
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-table-header">
            <tr className="border-b border-border">
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
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  暂无来源周表
                </td>
              </tr>
            ) : (
              sources.map((source) => (
                <tr key={`${source.timesheet_id}-${source.project_id}-${source.employee_id}`} className="border-b border-border/70 hover:bg-row-hover">
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
  const query = searchParams.get("q") || "";
  const selectedParam = Number(searchParams.get("projectId") || 0);
  const { data, isLoading, isError } = useDashboardAnalysis(startDate, endDate, grain);

  const updateParams = useCallback(
    (updates: Partial<Record<"sort" | "q" | "projectId", string>>) => {
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

  const projects = useMemo(() => data ? filteredProjects(data, query, sort) : [], [data, query, sort]);
  const selectedProject = useMemo(() => {
    if (!data) return null;
    return data.projects.find((project) => project.project_id === selectedParam) || projects[0] || null;
  }, [data, projects, selectedParam]);
  const selectedProjectId = selectedProject?.project_id ?? null;

  const projectDepartments = useMemo(
    () => (data?.departments || []).filter((item) => item.project_id === selectedProjectId),
    [data, selectedProjectId],
  );
  const projectEmployees = useMemo(
    () => (data?.employees || []).filter((item) => item.project_id === selectedProjectId),
    [data, selectedProjectId],
  );
  const projectTrend = useMemo(
    () => (data?.trend || []).filter((item) => item.project_id === selectedProjectId),
    [data, selectedProjectId],
  );
  const projectSources = useMemo(
    () => (data?.sources || []).filter((item) => item.project_id === selectedProjectId),
    [data, selectedProjectId],
  );
  const handleExport = useCallback(() => {
    if (!selectedProject) return;
    const rows = [
      "项目编号,项目名称,员工,部门,周表周期,工日,人力成本,周表状态",
      ...projectSources.map((source) => [
        selectedProject.project_code,
        `"${selectedProject.project_name}"`,
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
    anchor.download = `dashboard-analysis-${selectedProject.project_code}-${startDate}-${endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [endDate, projectSources, selectedProject, startDate]);

  if (isLoading) {
    return <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">加载分析数据…</div>;
  }

  if (isError || !data) {
    return <div className="flex h-[420px] items-center justify-center text-sm text-destructive">分析数据加载失败，请稍后重试</div>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-app">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">项目投入分析台</h2>
            <p className="text-xs text-muted-foreground">
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
            <span className="rounded-full bg-muted/40 px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
              {startDate} ~ {endDate}
            </span>
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={handleExport} disabled={!selectedProject}>
              <FileDown className="mr-1.5 size-3.5" aria-hidden="true" />
              导出分析
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[320px_minmax(0,1fr)_360px] gap-5 max-[1400px]:grid-cols-[300px_minmax(0,1fr)] max-[980px]:grid-cols-1">
        <ProjectRail
          projects={projects}
          selectedId={selectedProjectId}
          sort={sort}
          query={query}
          onSortChange={(value) => updateParams({ sort: value, projectId: "" })}
          onQueryChange={(value) => updateParams({ q: value, projectId: "" })}
          onSelect={(projectId) => updateParams({ projectId: String(projectId) })}
        />

        <div className="min-w-0 space-y-5">
          {selectedProject ? (
            <>
              <Card className="rounded-lg p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-semibold">{selectedProject.project_name}</h2>
                      <Badge variant="outline">{selectedProject.project_code}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedProject.department_count} 个部门 · {selectedProject.people_count} 人 · {selectedProject.timesheet_count} 份周表
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-right max-[720px]:w-full max-[720px]:grid-cols-1 max-[720px]:text-left">
                    <div>
                      <p className="text-xs text-muted-foreground">实际工日</p>
                      <strong className="text-xl tabular-nums">{selectedProject.labor_days.toFixed(1)}</strong>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">人力成本</p>
                      <strong className="text-xl tabular-nums">{compactMoney(selectedProject.labor_cost)}</strong>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">环比工日</p>
                      <strong className={cn("inline-flex items-center gap-1 text-xl tabular-nums", metricTone(selectedProject.labor_days_delta))}>
                        {selectedProject.labor_days_delta >= 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                        {selectedProject.labor_days_delta > 0 ? "+" : ""}
                        {selectedProject.labor_days_delta.toFixed(1)}
                      </strong>
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <BudgetStrip project={selectedProject} />
                </div>
              </Card>
              <TrendPanel trend={projectTrend} />
              <DonutPanel departments={projectDepartments} employees={projectEmployees} />
            </>
          ) : (
            <Card className="flex h-[520px] items-center justify-center rounded-lg p-5 text-sm text-muted-foreground">
              选择一个项目查看分析
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-5 max-[1400px]:col-span-2 max-[980px]:col-span-1">
          <EmployeeLoadPanel employees={projectEmployees} />
          <Card className="rounded-lg p-4">
            <div className="mb-3 flex items-center gap-2">
              <FileSearch className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-semibold">解释线索</h3>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground">投入最高人员</span>
                <span className="min-w-0 truncate font-medium">
                  {projectEmployees[0] ? `${projectEmployees[0].employee_name} · ${projectEmployees[0].labor_days.toFixed(1)} 工日` : "暂无"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground">最大部门占比</span>
                <span className="min-w-0 truncate font-medium">
                  {projectDepartments[0]
                    ? `${projectDepartments[0].department} · ${percentLabel(projectDepartments[0].labor_days / Math.max(selectedProject?.labor_days || 0, 1))}`
                    : "暂无"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground">来源周表</span>
                <span className="font-medium tabular-nums">{projectSources.length} 份</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <SourceTable sources={projectSources} />
    </div>
  );
}
