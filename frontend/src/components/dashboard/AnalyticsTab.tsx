import { useState, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lastNMonths, useMonthlyData } from "@/hooks/useMonthlyData";
import { formatMoney } from "@/utils/dates";
import type { DashboardProject } from "@/types/project";

interface AnalyticsTabProps {
  projects: DashboardProject[];
  totalLaborHours: number;
  totalLaborCost: number;
}

function formatWan(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(0)}万`;
  return value > 0 ? String(Math.round(value)) : "0";
}

function formatLabel(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(2)}万`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}千`;
  return String(Math.round(value));
}

/** Custom label renderer — hides zero values, formats with units */
function renderLabel(props: { x?: number; y?: number; value?: number; [key: string]: unknown }) {
  const { x = 0, y = 0, value = 0 } = props;
  if (!value || value === 0) return null;
  return (
    <text x={x} y={y - 10} textAnchor="middle" fill="hsl(0 72% 51%)" fontSize={13} fontWeight={600}>
      {formatLabel(value)}
    </text>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, e) => s + (e.value ?? 0), 0);
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-float text-sm">
      <p className="font-medium mb-1 text-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <span
            className="size-2 rounded-sm shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="font-medium tabular-nums ml-auto">
            {formatMoney(entry.value ?? 0)}
          </span>
        </div>
      ))}
      <div className="border-t border-border mt-1.5 pt-1 flex items-center gap-2 text-xs font-medium">
        <span className="text-muted-foreground">合计</span>
        <span className="tabular-nums ml-auto">{formatMoney(total)}</span>
      </div>
    </div>
  );
}

const TOTAL_VALUE = "total" as const;

export function AnalyticsTab({ projects, totalLaborHours, totalLaborCost }: AnalyticsTabProps) {
  const now = new Date();
  const [selectedValue, setSelectedValue] = useState<string>(TOTAL_VALUE);

  const months = useMemo(
    () => lastNMonths(6, now.getFullYear(), now.getMonth() + 1),
    [],
  );

  const { monthlyData, isLoading } = useMonthlyData(months, true);

  const selectedProject = selectedValue !== TOTAL_VALUE
    ? projects.find((p) => String(p.id) === selectedValue)
    : null;

  // Build chart data: single project or total of all projects
  const chartData = useMemo(() => {
    if (!monthlyData) return null;

    const globalRate =
      totalLaborHours > 0 && totalLaborCost > 0
        ? totalLaborCost / totalLaborHours
        : 0;

    if (selectedValue === TOTAL_VALUE) {
      // Sum up hours from ALL projects per month
      return months.map((m) => {
        let totalHours = 0;
        for (const row of monthlyData.rows) {
          totalHours += (row[m.label] as number) ?? 0;
        }
        return {
          month: m.label,
          人力开支: Math.round(totalHours * globalRate),
        };
      });
    }

    if (!selectedProject) return null;

    return months.map((m) => {
      const projRow = monthlyData.rows.find(
        (r) => r.month === selectedProject.code,
      );
      const hours = (projRow?.[m.label] as number) ?? 0;
      return {
        month: m.label,
        人力开支: Math.round(hours * globalRate),
      };
    });
  }, [monthlyData, months, selectedValue, selectedProject, totalLaborHours, totalLaborCost]);

  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        暂无项目数据
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-app">
      {/* Header: title + project selector */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h3 className="text-sm font-semibold">堆叠面积图-项目收支</h3>
        </div>

        <Select value={selectedValue} onValueChange={setSelectedValue}>
          <SelectTrigger className="h-8 text-sm w-[200px]">
            <SelectValue>
              {selectedValue === TOTAL_VALUE
                ? "总计 — 所有项目"
                : projects.find((p) => String(p.id) === selectedValue)?.name || ""}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TOTAL_VALUE}>总计 — 所有项目</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Chart */}
      {isLoading && (
        <div className="flex items-center justify-center h-[380px] text-sm text-muted-foreground">
          加载中…
        </div>
      )}

      {!isLoading && chartData && (
        <ResponsiveContainer width="100%" height={380}>
          <AreaChart
            data={chartData}
            margin={{ top: 24, right: 16, left: 0, bottom: 4 }}
          >
            <defs>
              <linearGradient
                id="fillCost"
                x1="0" y1="0" x2="0" y2="1"
              >
                <stop offset="5%" stopColor="hsl(0 72% 51%)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="hsl(0 72% 51%)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 13% 91%)" />
            <XAxis
              dataKey="month"
              stroke="#888888"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#888888"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatWan}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="人力开支"
              stroke="hsl(0 72% 51%)"
              fill="url(#fillCost)"
              strokeWidth={2}
            >
              <LabelList dataKey="人力开支" content={renderLabel} />
            </Area>
          </AreaChart>
        </ResponsiveContainer>
      )}

      {!isLoading && !chartData && (
        <div className="flex items-center justify-center h-[380px] text-sm text-muted-foreground">
          暂无数据
        </div>
      )}
    </div>
  );
}
