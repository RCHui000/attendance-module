import { lazy, Suspense } from "react";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import type { PeriodType } from "@/components/dashboard/periodUtils";
import { formatMoney } from "@/utils/dates";
import type { DashboardData } from "@/types/project";
import { TrendingUp } from "lucide-react";
import { MobileMetricGrid } from "./MobileMetricGrid";
import { MobileRankingList } from "./MobileRankingList";
import { DashboardProjectCard } from "./DashboardProjectCard";

const DashboardAnalysisWorkbench = lazy(() =>
  import("@/components/dashboard/DashboardAnalysisWorkbench").then((module) => ({
    default: module.DashboardAnalysisWorkbench,
  })),
);

interface DashboardMobileProps {
  data: DashboardData;
  dates: {
    startDate: string;
    endDate: string;
  };
  periodType: PeriodType;
  year: number;
  month: number;
  quarter: number;
  weekStart: string;
  onPeriodTypeChange: (type: PeriodType) => void;
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
  onQuarterChange: (quarter: number) => void;
  onWeekStartChange: (weekStart: string) => void;
}

function percentLabel(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}

export function DashboardMobile({
  data,
  dates,
  periodType,
  year,
  month,
  quarter,
  weekStart,
  onPeriodTypeChange,
  onYearChange,
  onMonthChange,
  onQuarterChange,
  onWeekStartChange,
}: DashboardMobileProps) {
  const contractTotal = data.projects.reduce((sum, project) => sum + (project.contract_amount || 0), 0);
  const receivedTotal = data.projects.reduce((sum, project) => sum + (project.received_amount || 0), 0);
  const avgMargin = data.projects.length > 0
    ? data.projects.reduce((sum, project) => sum + (project.gross_margin || 0), 0) / data.projects.length
    : 0;
  const recoveryRate = contractTotal > 0 ? (receivedTotal / contractTotal) * 100 : 0;
  const laborCostRatio = receivedTotal > 0 ? ((data.totalLaborCost || 0) / receivedTotal) * 100 : 0;
  const hoursPerPerson = data.totalPeople > 0 ? (data.totalLaborHours || 0) / data.totalPeople : 0;

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-3 shadow-app">
        <div className="flex items-start gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">统计周期</p>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              {dates.startDate} ~ {dates.endDate}
            </p>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto pb-1">
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
        </div>
      </section>

      <MobileMetricGrid dashboard={data} />

      <section className="rounded-lg border border-border bg-card p-3 shadow-app">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">经营状态</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md bg-accent p-2">
            <p className="text-muted-foreground">回款率</p>
            <strong className="mt-1 block text-base tabular-nums">{percentLabel(recoveryRate)}</strong>
          </div>
          <div className="rounded-md bg-accent p-2">
            <p className="text-muted-foreground">人力成本占比</p>
            <strong className="mt-1 block text-base tabular-nums">{percentLabel(laborCostRatio)}</strong>
          </div>
          <div className="rounded-md bg-accent p-2">
            <p className="text-muted-foreground">平均毛利率</p>
            <strong className="mt-1 block text-base tabular-nums">{percentLabel(avgMargin)}</strong>
          </div>
          <div className="rounded-md bg-accent p-2">
            <p className="text-muted-foreground">人均工日</p>
            <strong className="mt-1 block text-base tabular-nums">{hoursPerPerson.toFixed(1)}</strong>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          人力开支 {formatMoney(data.totalLaborCost || 0)}
        </p>
      </section>

      <MobileRankingList projects={data.projects} />

      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">项目经营卡片</h2>
          <span className="text-xs text-muted-foreground">{data.projects.length} 个项目</span>
        </div>
        {data.projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            暂无项目数据
          </div>
        ) : (
          <div className="space-y-2.5">
            {data.projects.map((project) => (
              <DashboardProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">分析入口</h2>
          <span className="text-xs text-muted-foreground">项目 / 部门 / 人员</span>
        </div>
        <Suspense
          fallback={<div aria-label="分析加载中" className="h-48 animate-pulse rounded-md bg-muted/60" />}
        >
          <DashboardAnalysisWorkbench startDate={dates.startDate} endDate={dates.endDate} />
        </Suspense>
      </section>
    </div>
  );
}
