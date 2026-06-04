import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Building2,
  FolderKanban,
  UserRound,
  Users,
} from "lucide-react";
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

const PERSPECTIVES: Array<{
  value: Perspective;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "project", label: "项目视角", icon: <FolderKanban className="size-4" /> },
  { value: "department", label: "部门视角", icon: <Building2 className="size-4" /> },
  { value: "employee", label: "人员视角", icon: <UserRound className="size-4" /> },
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
  item.departmentNames.add(row.department || "未分配部门");
  item.rows.push(row);
}

function buildSummaries(rows: LaborMatrixRow[], perspective: Perspective): SummaryRow[] {
  const map = new Map<string, SummaryRow>();
  for (const row of rows) {
    if (perspective === "project") {
      addSummary(
        map,
        String(row.project_id),
        row.project_name,
        row.project_code,
        row,
      );
    }
    if (perspective === "department") {
      addSummary(
        map,
        row.department || "未分配部门",
        row.department || "未分配部门",
        `${row.department || "未分配部门"}投入`,
        row,
      );
    }
    if (perspective === "employee") {
      addSummary(
        map,
        String(row.employee_id),
        row.employee_name,
        row.department || "未分配部门",
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

function groupRows(
  rows: LaborMatrixRow[],
  mode: "project" | "employee" | "department",
) {
  const map = new Map<string, SummaryRow>();
  for (const row of rows) {
    if (mode === "project") {
      addSummary(map, String(row.project_id), row.project_name, row.project_code, row);
    }
    if (mode === "employee") {
      addSummary(map, String(row.employee_id), row.employee_name, row.department || "未分配部门", row);
    }
    if (mode === "department") {
      addSummary(map, row.department || "未分配部门", row.department || "未分配部门", "部门", row);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
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
      departments.add(row.department || "未分配部门");
      totalHours += row.total_hours || 0;
      laborCost += row.labor_cost || 0;
    }
    return [
      { label: "活跃项目", value: String(projects.size), hint: "本期有投入", icon: <FolderKanban className="size-4" /> },
      { label: "投入工日", value: totalHours.toFixed(1), hint: "已审批/归档周表", icon: <Users className="size-4" /> },
      { label: "人力成本", value: formatMoney(laborCost), hint: "按员工日成本", icon: <UserRound className="size-4" /> },
      { label: "参与部门", value: String(departments.size), hint: `${employees.size} 名员工`, icon: <Building2 className="size-4" /> },
    ];
  }, [rows]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {stats.map((stat) => (
        <Card key={stat.label} className="rounded-lg p-4 shadow-app">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <strong className="block mt-1 text-2xl font-bold tabular-nums">
                {stat.value}
              </strong>
              <p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p>
            </div>
            <span className="text-muted-foreground/60">{stat.icon}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

function TrendBars({ items }: { items: SummaryRow[] }) {
  const chartData = items.slice(0, 10).map((item) => ({
    name: item.label.length > 9 ? `${item.label.slice(0, 9)}…` : item.label,
    工日: Number(item.totalHours.toFixed(1)),
    成本: item.laborCost,
  })).reverse();

  if (chartData.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        暂无投入数据
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(300, chartData.length * 34)}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 18, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(220 13% 91%)" />
        <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" width={88} fontSize={11} tickLine={false} axisLine={false} />
        <Tooltip
          cursor={{ fill: "hsl(220 14% 96%)" }}
          formatter={(value, name) => name === "成本" ? formatMoney(Number(value)) : `${value} 工日`}
        />
        <Bar dataKey="工日" fill="#2f80ed" radius={[0, 4, 4, 0]} barSize={12} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function SummaryTable({
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
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="sticky top-0 bg-table-header">
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left text-xs font-bold text-muted-foreground">对象</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground">项目数</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground">人数</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground">部门数</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground">工日</th>
            <th className="px-3 py-2 text-right text-xs font-bold text-muted-foreground">人力成本</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className={cn(
                "cursor-pointer border-b border-border/70 transition-colors hover:bg-row-hover",
                selectedId === item.id && "bg-row-selected",
              )}
              onClick={() => onSelect(item.id)}
            >
              <td className="px-3 py-2">
                <div className="font-medium">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.subLabel || "—"}</div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{item.projectIds.size}</td>
              <td className="px-3 py-2 text-right tabular-nums">{item.employeeIds.size}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {perspective === "department" ? "—" : item.departmentNames.size}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{item.totalHours.toFixed(1)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(item.laborCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <Card className="flex min-h-[420px] items-center justify-center rounded-lg p-5 text-sm text-muted-foreground shadow-app">
        选择一行查看拆分
      </Card>
    );
  }

  const primaryMode = perspective === "employee" ? "project" : "project";
  const secondaryMode = perspective === "project" ? "department" : "employee";
  const primary = groupRows(selected.rows, primaryMode);
  const secondary = groupRows(selected.rows, secondaryMode);

  return (
    <Card className="rounded-lg p-5 shadow-app">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{selected.label}</h3>
            <Badge variant="outline">{selected.subLabel || "明细"}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {selected.projectIds.size} 个项目 · {selected.employeeIds.size} 人 · {selected.totalHours.toFixed(1)} 工日
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">人力成本</p>
          <strong className="text-xl tabular-nums">{formatMoney(selected.laborCost)}</strong>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div>
          <h4 className="mb-3 text-sm font-semibold">
            {perspective === "employee" ? "项目投入" : "项目分布"}
          </h4>
          <div className="space-y-2.5">
            {primary.map((item) => (
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
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-semibold">
            {perspective === "project" ? "部门拆分" : "人员拆分"}
          </h4>
          <div className="space-y-2.5">
            {secondary.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{item.label}</span>
                <div className="h-5 flex-1 overflow-hidden rounded-sm bg-muted/40">
                  <div
                    className="h-full rounded-sm bg-primary/75"
                    style={{
                      width: `${Math.max((item.totalHours / selected.totalHours) * 100, 3)}%`,
                    }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums">
                  {item.totalHours.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
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

  const summaries = useMemo(
    () => buildSummaries(data, perspective),
    [data, perspective],
  );
  const selectedId = selectedByPerspective[perspective] || summaries[0]?.id || null;
  const selected = summaries.find((item) => item.id === selectedId);

  if (isLoading) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
        加载投入矩阵…
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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
        <Card className="rounded-lg p-5 shadow-app">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">投入排行</h3>
              <p className="text-xs text-muted-foreground">
                按工日排序，成本辅助判断投入强度
              </p>
            </div>
            <Badge variant="secondary">{compactNumber(summaries.reduce((sum, item) => sum + item.laborCost, 0))} 成本</Badge>
          </div>
          <TrendBars items={summaries} />
        </Card>

        <DetailPanel selected={selected} perspective={perspective} />
      </div>

      <SummaryTable
        items={summaries}
        perspective={perspective}
        selectedId={selectedId}
        onSelect={(id) =>
          setSelectedByPerspective((current) => ({
            ...current,
            [perspective]: id,
          }))
        }
      />
    </div>
  );
}
