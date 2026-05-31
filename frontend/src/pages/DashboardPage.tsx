import { useState, useMemo, useCallback } from "react";
import { useDashboard } from "@/hooks/useProjects";
import { MetricCards } from "@/components/dashboard/MetricCards";
import { DashboardTable } from "@/components/dashboard/DashboardTable";
import {
  PeriodFilter,
  computePeriodDates,
  type PeriodType,
} from "@/components/dashboard/PeriodFilter";
import { Button } from "@/components/ui/button";
import { RefreshCw, FileDown } from "lucide-react";

export default function DashboardPage() {
  const now = new Date();
  const [periodType, setPeriodType] = useState<PeriodType>("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [quarter, setQuarter] = useState(
    Math.floor(now.getMonth() / 3) + 1,
  );

  // Compute start/end from period settings
  const dates = useMemo(
    () => computePeriodDates(periodType, year, month, quarter),
    [periodType, year, month, quarter],
  );

  // All dashboard data uses the period date range
  const { data, isLoading, isError, refetch } = useDashboard(
    dates.startDate,
    dates.endDate,
  );

  // Export: build CSV from current dashboard data
  const handleExport = useCallback(() => {
    if (!data?.projects) return;
    const rows: string[] = [];
    rows.push("﻿项目代码,项目名称,合同额,已回款,待回款,工日,人力成本,毛利");
    data.projects.forEach((p) => {
      rows.push(
        [
          p.code,
          `"${p.name}"`,
          p.contract_amount,
          p.received_amount,
          p.receivable_amount,
          (p.labor_days || 0).toFixed(1),
          p.labor_cost,
          p.gross_profit,
        ].join(","),
      );
    });
    const blob = new Blob([rows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-${dates.startDate}-${dates.endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, dates]);

  return (
    <div>
      {/* Header: PeriodFilter (left) + actions (right) */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <PeriodFilter
          periodType={periodType}
          year={year}
          month={month}
          quarter={quarter}
          onPeriodTypeChange={(t) => {
            setPeriodType(t);
            // Reset quarter/month when switching type
            if (t === "quarter" && quarter === 0) {
              setQuarter(Math.floor(now.getMonth() / 3) + 1);
            }
          }}
          onYearChange={setYear}
          onMonthChange={setMonth}
          onQuarterChange={setQuarter}
        />

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {dates.startDate} ~ {dates.endDate}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="size-3.5 mr-1" />
            刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!data}
          >
            <FileDown className="size-3.5 mr-1" />
            导出
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      )}

      {isError && (
        <div className="py-16 text-center text-sm text-destructive">
          数据加载失败，请点击刷新重试
        </div>
      )}

      {data && (
        <>
          <MetricCards dashboard={data} />
          <DashboardTable
            projects={data.projects}
            startDate={dates.startDate}
            endDate={dates.endDate}
          />
        </>
      )}
    </div>
  );
}
