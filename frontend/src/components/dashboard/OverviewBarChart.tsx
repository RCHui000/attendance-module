import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardProject } from "@/types/project";

interface OverviewBarChartProps {
  projects: DashboardProject[];
}

/** Format amount in 万元 for axis labels */
function formatWan(value: number): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(0)}万`;
  }
  return String(value);
}

/** Custom tooltip showing full currency values */
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
            ¥{(entry.value ?? 0).toLocaleString("zh-CN")}
          </span>
        </div>
      ))}
    </div>
  );
}

export function OverviewBarChart({ projects }: OverviewBarChartProps) {
  // Take top 12 projects by contract amount for chart readability
  const chartData = [...projects]
    .sort((a, b) => (b.contract_amount || 0) - (a.contract_amount || 0))
    .slice(0, 12)
    .map((p) => ({
      name: p.code,
      fullName: p.name,
      已回款: p.received_amount || 0,
      人力成本: p.labor_cost || 0,
    }))
    .reverse(); // Reverse so largest bars are at top in horizontal layout

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[350px] rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        暂无项目数据
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(350, chartData.length * 40)}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(220 13% 91%)"
          horizontal={false}
        />
        <XAxis
          type="number"
          stroke="#888888"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatWan}
        />
        <YAxis
          type="category"
          dataKey="name"
          stroke="#888888"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={60}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(220 14% 96%)" }} />
        <Bar
          dataKey="已回款"
          fill="currentColor"
          className="fill-success"
          radius={[0, 4, 4, 0]}
          barSize={14}
        />
        <Bar
          dataKey="人力成本"
          fill="currentColor"
          className="fill-destructive"
          radius={[0, 4, 4, 0]}
          barSize={14}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
