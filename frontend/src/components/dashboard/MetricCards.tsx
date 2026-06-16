import { Card } from "@/components/ui/card";
import { formatMoney } from "@/utils/dates";
import {
  FileText,
  CircleDollarSign,
  Clock,
  CalendarDays,
  Users,
  FolderKanban,
} from "lucide-react";
import type { DashboardData } from "@/types/project";

interface MetricCardsProps {
  dashboard: DashboardData;
}

interface MetricCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  valueClassName?: string;
}

function MetricCard({ label, value, icon, valueClassName }: MetricCardProps) {
  return (
    <Card className="min-w-[160px] flex-1 p-4 shadow-app rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <span className="text-muted-foreground/60">{icon}</span>
      </div>
      <strong
        className={`block text-2xl font-bold tabular-nums ${valueClassName ?? ""}`}
      >
        {value}
      </strong>
    </Card>
  );
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

  const metrics: MetricCardProps[] = [
    {
      label: "合同额",
      value: formatMoney(contracts),
      icon: <FileText className="size-4" />,
    },
    {
      label: "已回款",
      value: formatMoney(received),
      icon: <CircleDollarSign className="size-4" />,
      valueClassName: "text-success",
    },
    {
      label: "待回款",
      value: formatMoney(receivable),
      icon: <Clock className="size-4" />,
      valueClassName: "text-warning",
    },
    {
      label: "期间总工日",
      value: dashboard.totalLaborHours?.toFixed(1) || "0",
      icon: <CalendarDays className="size-4" />,
    },
    {
      label: "人力开支",
      value: formatMoney(dashboard.totalLaborCost || 0),
      icon: <Users className="size-4" />,
      valueClassName: "text-destructive",
    },
    {
      label: "活跃项目",
      value: String(dashboard.projects.length || 0),
      icon: <FolderKanban className="size-4" />,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
      {metrics.map((m) => (
        <MetricCard key={m.label} {...m} />
      ))}
    </div>
  );
}
