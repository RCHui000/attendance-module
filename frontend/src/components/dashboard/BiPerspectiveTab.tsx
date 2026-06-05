import { useMemo, useState } from "react";
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
} from "recharts";
import { Building2, FolderKanban, UserRound, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLaborMatrix } from "@/hooks/useReport";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/utils/dates";
import type { LaborMatrixRow } from "@/types/project";

type Perspective = "project" | "department" | "employee";

interface BiPerspectiveTabProps {
  startDate: string;
  endDate: string;
}

interface SummaryRow {
  id: string;
  label: string;
  subLabel: string;
  totalHours: number;
  laborCost: number;
  projectIds: Set<number>;
  employeeIds: Set<number>;
  departmentNames: Set<string>;
  rows: LaborMatrixRow[];
}

const UNKNOWN_DEPARTMENT = "未分配部门";

const PERSPECTIVES: Array<{
  value: Perspective;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "project", label: "项目视角", icon: <FolderKanban className="size-4" /> },
  { value: "department", label: "部门视角", icon: <Building2 className="size-4" /> },
  { value: "employee", label: "人员视角", icon: <UserRound className="size-4" /> },
];

const CHART_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f97316",
  "#9333ea",
  "#0891b2",
  "#e11d48",
  "#ca8a04",
  "#475569",
  "#0d9488",
  "#7c3aed",
];

function addSummary(
  map: Map<string, SummaryRow>,
  key: string,
  label: string,
  subLabel: string,
  row: LaborMatrixRow,
) {
  if (!map.has(key)) {
    map.set(key, {
      id: key,
      label,
      subLabel,
      totalHours: 0,
      laborCost: 0,
      projectIds: new Set<number>(),
      employeeIds: new Set<number>(),
      departmentNames: new Set<string>(),
      rows: [],
    });
  }
  const item = map.get(key)!;
  item.totalHours += row.total_hours || 0;
  item.laborCost += row.labor_cost || 0;
  item.projectIds.add(row.project_id);
  item.employeeIds.add(row.employee_id);
  item.departmentNames.add(row.department || UNKNOWN_DEPARTMENT);
  item.rows.push(row);
}

function buildSummaries(rows: LaborMatrixRow[], perspective: Perspective): SummaryRow[] {
  const map = new Map<string, SummaryRow>();
  for (const row of rows) {
    if (perspective === "project") {
      addSummary(map, String(row.project_id), row.project_name, row.project_code, row);
    }
    if (perspective === "department") {
      const department = row.department || UNKNOWN_DEPARTMENT;
      addSummary(map, department, department, `${department}投入`, row);
    }
    if (perspective === "employee") {
      addSummary(
        map,
        String(row.employee_id),
        row.employee_name,
        row.department || UNKNOWN_DEPARTMENT,
        row,
      );
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
}

function groupRows(rows: LaborMatrixRow[], mode: Perspective) {
  const map = new Map<string, SummaryRow>();
  for (const row of rows) {
    if (mode === "project") {
      addSummary(map, String(row.project_id), row.project_name, row.project_code, row);
    }
    if (mode === "department") {
      const department = row.department || UNKNOWN_DEPARTMENT;
      addSummary(map, department, department, "部门", row);
    }
    if (mode === "employee") {
      addSummary(
        map,
        String(row.employee_id),
        row.employee_name,
        row.department || UNKNOWN_DEPARTMENT,
        row,
      );
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
}

function compactNumber(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(Math.round(value));
}

function hoursLabel(value: number): string {
  return `${Number(value || 0).toFixed(1)} 工日`;
}

function MetricStrip({ rows }: { rows: LaborMatrixRow[] }) {
  const stats = useMemo(() => {
    const projects = new Set<number>();
    const employees = new Set<number>();
    const departments = new Set<string>();
    let totalHours = 0;
    let laborCost = 0;
    for (const row of rows) {
      projects.add(row.project_id);
      employees.add(row.employee_id);
      departments.add(row.department || UNKNOWN_DEPARTMENT);
      totalHours += row.total_hours || 0;
      laborCost += row.labor_cost || 0;
    }
    return [
      { label: "活跃项目", value: String(projects.size), hint: "本期有投入", icon: <FolderKanban className="size-4" /> },
      { label: "投入工日", value: totalHours.toFixed(1), hint: "已审批归档周表", icon: <Users className="size-4" /> },
      { label: "人力成本", value: formatMoney(laborCost), hint: "按员工日成本", icon: <UserRound className="size-4" /> },
      { label: "参与部门", value: String(departments.size), hint: `${employees.size} 名员工`, icon: <Building2 className="size-4" /> },
    ];
  }, [rows]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="rounded-lg p-4 shadow-app">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <strong className="mt-1 block text-2xl font-bold tabular-nums">{stat.value}</strong>
              <p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p>
            </div>
            <span className="text-muted-foreground/60">{stat.icon}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ObjectRail({
  items,
  perspective,
  selectedId,
  onSelect,
}: {
  items: SummaryRow[];
  perspective: Perspective;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const title = perspective === "project" ? "项目对象" : perspective === "department" ? "部门对象" : "人员对象";

  return (
    <Card className="rounded-lg p-4 shadow-app">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">点击对象切换左侧明细</p>
        </div>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      <div className="max-h-[720px] space-y-2 overflow-auto pr-1">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              "w-full rounded-md border border-border bg-background px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-row-hover",
              selectedId === item.id && "border-primary/60 bg-row-selected shadow-sm",
            )}
            onClick={() => onSelect(item.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                    #{index + 1}
                  </span>
                  <p className="truncate text-sm font-semibold">{item.label}</p>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.subLabel || "明细对象"}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold tabular-nums">{item.totalHours.toFixed(1)}</p>
                <p className="text-[11px] text-muted-foreground">工日</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <span>{item.projectIds.size} 项目</span>
              <span>{item.employeeIds.size} 人</span>
              <span className="text-right">{formatMoney(item.laborCost)}</span>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function ProjectPie({ items }: { items: SummaryRow[] }) {
  const chartData = items.slice(0, 10).map((item) => ({
    id: item.id,
    name: item.label,
    value: Number(item.totalHours.toFixed(1)),
    cost: item.laborCost,
  }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        暂无项目投入数据
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
      <div className="h-[320px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={70}
              outerRadius={118}
              paddingAngle={4}
              cornerRadius={9}
              stroke="hsl(var(--card))"
              strokeWidth={3}
            >
              {chartData.map((entry, index) => (
                <Cell key={entry.id} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: unknown, name: unknown, props: { payload?: { cost?: number } }) => [
                `${value} 工日 / ${formatMoney(Number(props.payload?.cost || 0))}`,
                String(name),
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2 self-center">
        {chartData.slice(0, 8).map((item, index) => (
          <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              <span className="truncate">{item.name}</span>
            </div>
            <span className="shrink-0 font-medium tabular-nums">{item.value.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankingBars({ items }: { items: SummaryRow[] }) {
  const chartData = items
    .slice(0, 10)
    .map((item) => ({
      name: item.label.length > 9 ? `${item.label.slice(0, 9)}...` : item.label,
      工日: Number(item.totalHours.toFixed(1)),
      成本: item.laborCost,
    }))
    .reverse();

  if (chartData.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        暂无投入排行数据
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(280, chartData.length * 34)}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 18, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(220 13% 91%)" />
        <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" width={88} fontSize={11} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: "hsl(220 14% 96%)" }}
          formatter={(value: unknown, name: unknown) =>
            name === "成本" ? formatMoney(Number(value)) : hoursLabel(Number(value))
          }
        />
        <Bar dataKey="工日" fill="#2563eb" radius={[0, 5, 5, 0]} barSize={13} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmployeeStackedBars({ rows }: { rows: LaborMatrixRow[] }) {
  const { chartData, projects } = useMemo(() => {
    const topProjects = groupRows(rows, "project").slice(0, 8);
    const projectMeta = topProjects.map((project, index) => ({
      id: project.id,
      key: `project_${project.id}`,
      name: project.label,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
    const projectIds = new Set(projectMeta.map((project) => project.id));
    const employeeMap = new Map<string, Record<string, string | number>>();

    for (const row of rows) {
      const employeeKey = String(row.employee_id);
      if (!employeeMap.has(employeeKey)) {
        employeeMap.set(employeeKey, { name: row.employee_name, total: 0 });
      }
      const item = employeeMap.get(employeeKey)!;
      const projectKey = projectIds.has(String(row.project_id)) ? `project_${row.project_id}` : "project_other";
      item[projectKey] = Number(item[projectKey] || 0) + (row.total_hours || 0);
      item.total = Number(item.total || 0) + (row.total_hours || 0);
    }

    const hasOther = Array.from(employeeMap.values()).some((item) => Number(item.project_other || 0) > 0);
    if (hasOther) {
      projectMeta.push({ id: "other", key: "project_other", name: "其他项目", color: "#64748b" });
    }

    return {
      projects: projectMeta,
      chartData: Array.from(employeeMap.values()).sort((a, b) => Number(b.total) - Number(a.total)),
    };
  }, [rows]);

  if (chartData.length === 0 || projects.length === 0) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        暂无人员投入排行数据
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={360}>
        <BarChart data={chartData} margin={{ top: 8, right: 18, left: 0, bottom: 34 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(220 13% 91%)" />
          <XAxis
            dataKey="name"
            interval={0}
            angle={-18}
            textAnchor="end"
            height={58}
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis fontSize={11} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "hsl(220 14% 96%)" }}
            formatter={(value: unknown, name: unknown) => [hoursLabel(Number(value)), String(name)]}
          />
          {projects.map((project, index) => (
            <Bar
              key={project.key}
              dataKey={project.key}
              name={project.name}
              stackId="hours"
              fill={project.color}
              radius={index === projects.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]}
              barSize={32}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {projects.map((project) => (
          <div key={project.key} className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: project.color }} />
            <span>{project.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailList({
  title,
  items,
  selected,
}: {
  title: string;
  items: SummaryRow[];
  selected: SummaryRow;
}) {
  return (
    <div>
      <h4 className="mb-3 text-sm font-semibold">{title}</h4>
      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.id} className="rounded-md border border-border px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.subLabel}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">{item.totalHours.toFixed(1)} 工日</p>
                <p className="text-xs text-muted-foreground">{formatMoney(item.laborCost)}</p>
              </div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max((item.totalHours / selected.totalHours) * 100, 3)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailPanel({
  selected,
  perspective,
}: {
  selected?: SummaryRow;
  perspective: Perspective;
}) {
  if (!selected) {
    return (
      <Card className="flex min-h-[360px] items-center justify-center rounded-lg p-5 text-sm text-muted-foreground shadow-app">
        选择右侧对象查看明细
      </Card>
    );
  }

  const primaryMode: Perspective = perspective === "project" ? "department" : "project";
  const secondaryMode: Perspective = perspective === "employee" ? "department" : "employee";
  const primary = groupRows(selected.rows, primaryMode);
  const secondary = groupRows(selected.rows, secondaryMode);
  const primaryTitle = perspective === "project" ? "部门拆分" : "项目明细";
  const secondaryTitle =
    perspective === "project" ? "人员明细" : perspective === "employee" ? "部门归属" : "人员拆分";

  return (
    <Card className="rounded-lg p-5 shadow-app">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{selected.label}</h3>
            <Badge variant="outline">{selected.subLabel || "明细"}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {selected.projectIds.size} 个项目 · {selected.employeeIds.size} 人 · {selected.totalHours.toFixed(1)} 工日
          </p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="text-xs text-muted-foreground">人力成本</p>
          <strong className="text-xl tabular-nums">{formatMoney(selected.laborCost)}</strong>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <DetailList title={primaryTitle} items={primary} selected={selected} />
        <DetailList title={secondaryTitle} items={secondary} selected={selected} />
      </div>
    </Card>
  );
}

function RankingCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-lg p-5 shadow-app">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

export function BiPerspectiveTab({ startDate, endDate }: BiPerspectiveTabProps) {
  const [perspective, setPerspective] = useState<Perspective>("department");
  const [selectedByPerspective, setSelectedByPerspective] = useState<Record<Perspective, string | null>>({
    project: null,
    department: null,
    employee: null,
  });
  const { data = [], isLoading, isError } = useLaborMatrix({ startDate, endDate });

  const summaries = useMemo(() => buildSummaries(data, perspective), [data, perspective]);
  const selectedId = selectedByPerspective[perspective] || summaries[0]?.id || null;
  const selected = summaries.find((item) => item.id === selectedId);

  const handleSelect = (id: string) => {
    setSelectedByPerspective((current) => ({
      ...current,
      [perspective]: id,
    }));
  };

  if (isLoading) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
        加载投入矩阵...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-destructive">
        投入矩阵加载失败，请刷新重试
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        当前周期暂无已审批投入数据
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          {PERSPECTIVES.map((item) => (
            <Button
              key={item.value}
              type="button"
              variant={perspective === item.value ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setPerspective(item.value)}
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
        </div>
        <div className="text-xs text-muted-foreground">
          {startDate} ~ {endDate} · 成本按员工日成本计算
        </div>
      </div>

      <MetricStrip rows={data} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        {perspective === "project" ? (
          <div className="space-y-5">
            <RankingCard
              title="项目投入占比"
              hint={`按项目工日汇总，当前成本合计 ${compactNumber(
                summaries.reduce((sum, item) => sum + item.laborCost, 0),
              )}`}
            >
              <ProjectPie items={summaries} />
            </RankingCard>
            <DetailPanel selected={selected} perspective={perspective} />
          </div>
        ) : (
          <div className="space-y-5">
            <DetailPanel selected={selected} perspective={perspective} />
            <RankingCard
              title={perspective === "department" ? "部门投入排行" : "人员项目投入排行"}
              hint={
                perspective === "department"
                  ? "按部门汇总本周期投入工日"
                  : "X 轴为员工，色块为不同项目投入"
              }
            >
              {perspective === "employee" ? (
                <EmployeeStackedBars rows={data} />
              ) : (
                <RankingBars items={summaries} />
              )}
            </RankingCard>
          </div>
        )}

        <ObjectRail
          items={summaries}
          perspective={perspective}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>
    </div>
  );
}
