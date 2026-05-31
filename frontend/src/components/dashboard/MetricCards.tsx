import { Card } from "@/components/ui/card";
import { formatMoney } from "@/utils/dates";
import type { DashboardData } from "@/types/project";

interface MetricCardsProps {
  dashboard: DashboardData;
}

export function MetricCards({ dashboard }: MetricCardsProps) {
  const contracts = dashboard.projects.reduce(
    (sum, p) => sum + (p.contract_amount || 0),
    0,
  );
  const received = dashboard.projects.reduce(
    (sum, p) => sum + (p.received_amount || 0),
    0,
  );
  const receivable = dashboard.projects.reduce(
    (sum, p) => sum + (p.receivable_amount || 0),
    0,
  );

  return (
    <div className="flex gap-3 mb-5 flex-wrap">
      <Card className="min-w-[160px] flex-1 p-3.5 shadow-app rounded-lg">
        <span className="text-xs text-muted-foreground">合同额</span>
        <strong className="block text-2xl font-bold tabular-nums mt-1">
          {formatMoney(contracts)}
        </strong>
      </Card>
      <Card className="min-w-[160px] flex-1 p-3.5 shadow-app rounded-lg">
        <span className="text-xs text-muted-foreground">已回款</span>
        <strong className="block text-2xl font-bold tabular-nums mt-1 text-success">
          {formatMoney(received)}
        </strong>
      </Card>
      <Card className="min-w-[160px] flex-1 p-3.5 shadow-app rounded-lg">
        <span className="text-xs text-muted-foreground">待回款</span>
        <strong className="block text-2xl font-bold tabular-nums mt-1 text-warning">
          {formatMoney(receivable)}
        </strong>
      </Card>
      <Card className="min-w-[160px] flex-1 p-3.5 shadow-app rounded-lg bg-card">
        <span className="text-xs text-muted-foreground">期间总工日</span>
        <strong className="block text-2xl font-bold tabular-nums mt-1">
          {dashboard.totalLaborHours?.toFixed(1) || "0"}
        </strong>
      </Card>
      <Card className="min-w-[160px] flex-1 p-3.5 shadow-app rounded-lg bg-card">
        <span className="text-xs text-muted-foreground">人力开支</span>
        <strong className="block text-2xl font-bold tabular-nums mt-1 text-destructive">
          {formatMoney(dashboard.totalLaborCost || 0)}
        </strong>
      </Card>
      <Card className="min-w-[160px] flex-1 p-3.5 shadow-app rounded-lg bg-card">
        <span className="text-xs text-muted-foreground">活跃项目</span>
        <strong className="block text-2xl font-bold tabular-nums mt-1">
          {dashboard.totalPeople || 0}
        </strong>
      </Card>
    </div>
  );
}
