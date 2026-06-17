import { Card } from "@/components/ui/card";
import { formatMoney } from "@/utils/dates";
import type { DashboardData } from "@/types/project";

interface MobileMetricGridProps {
  dashboard: DashboardData;
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card className="rounded-lg p-3 shadow-app">
      <p className="text-xs text-muted-foreground">{label}</p>
      <strong className={`mt-1 block truncate text-lg font-semibold tabular-nums ${tone || ""}`}>
        {value}
      </strong>
    </Card>
  );
}

export function MobileMetricGrid({ dashboard }: MobileMetricGridProps) {
  const contracts = dashboard.projects.reduce((sum, project) => sum + (project.contract_amount || 0), 0);
  const received = dashboard.projects.reduce((sum, project) => sum + (project.received_amount || 0), 0);

  const metrics = [
    { label: "合同额", value: formatMoney(contracts) },
    { label: "已回款", value: formatMoney(received), tone: "text-success" },
    { label: "期间总工日", value: (dashboard.totalLaborHours || 0).toFixed(1) },
    { label: "人力开支", value: formatMoney(dashboard.totalLaborCost || 0), tone: "text-destructive" },
    { label: "活跃项目", value: String(dashboard.projects.length || 0) },
    { label: "参与人数", value: String(dashboard.totalPeople || 0) },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {metrics.map((metric) => (
        <MetricTile key={metric.label} {...metric} />
      ))}
    </div>
  );
}
