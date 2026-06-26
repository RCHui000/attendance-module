import { useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboard } from "@/hooks/useProjects";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { MetricCards } from "@/components/dashboard/MetricCards";
import { DashboardTable } from "@/components/dashboard/DashboardTable";
import { DashboardAnalysisWorkbench } from "@/components/dashboard/DashboardAnalysisWorkbench";
import { DashboardMobile } from "@/pages/dashboard/DashboardMobile";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import { computePeriodDates, type PeriodType } from "@/components/dashboard/periodUtils";
import { Button } from "@/components/ui/button";
import { isoDate, mondayOfWeek } from "@/utils/dates";
import { FileDown } from "lucide-react";

type DashboardTab = "overview" | "analytics";

export default function DashboardPage() {
  const now = new Date();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const periodParam = searchParams.get("period");
  const yearParam = Number(searchParams.get("year"));
  const monthParam = Number(searchParams.get("month"));
  const quarterParam = Number(searchParams.get("quarter"));
  const weekStartParam = searchParams.get("weekStart") || "";
  const tabParam = searchParams.get("tab");

  const periodType: PeriodType =
    periodParam === "week" || periodParam === "month" || periodParam === "quarter" || periodParam === "year"
      ? periodParam
      : "year";
  const year = Number.isInteger(yearParam) && yearParam > 2000 ? yearParam : now.getFullYear();
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : now.getMonth() + 1;
  const quarter =
    Number.isInteger(quarterParam) && quarterParam >= 1 && quarterParam <= 4
      ? quarterParam
      : Math.floor(now.getMonth() / 3) + 1;
  const weekStart = weekStartParam ? mondayOfWeek(weekStartParam) : mondayOfWeek(isoDate(now));
  const activeTab: DashboardTab = tabParam === "analytics" ? "analytics" : "overview";

  const updateDashboardParams = useCallback(
    (updates: Partial<Record<"period" | "year" | "month" | "quarter" | "weekStart" | "tab", string>>) => {
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

  const dates = useMemo(
    () => computePeriodDates(periodType, year, month, quarter, weekStart),
    [periodType, year, month, quarter, weekStart],
  );

  const { data, isLoading, isError } = useDashboard(
    dates.startDate,
    dates.endDate,
  );

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
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dashboard-${dates.startDate}-${dates.endDate}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [data, dates]);

  return (
    <div className="space-y-5">
      {/* Loading / Error */}
      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <p className="text-sm text-muted-foreground">加载中…</p>
        </div>
      )}
      {isError && (
        <div className="flex items-center justify-center py-24">
          <p className="text-sm text-destructive">数据加载失败，请稍后重试</p>
        </div>
      )}

      {/* Data loaded */}
      {data && (
        <div role="tabpanel" className="animate-fade-in">
          {isMobile ? (
            <DashboardMobile
              data={data}
              dates={dates}
              periodType={periodType}
              year={year}
              month={month}
              quarter={quarter}
              weekStart={weekStart}
              onPeriodTypeChange={(t) => updateDashboardParams({ period: t })}
              onYearChange={(value) => updateDashboardParams({ year: String(value) })}
              onMonthChange={(value) => updateDashboardParams({ month: String(value) })}
              onQuarterChange={(value) => updateDashboardParams({ quarter: String(value) })}
              onWeekStartChange={(value) => updateDashboardParams({ weekStart: value })}
            />
          ) : (
          <>
          {/* ---- Overview Tab ---- */}
          {activeTab === "overview" && (
            <section aria-label="总览" className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-app">
                <div>
                  <h2 className="text-base font-semibold">总览</h2>
                  <p className="text-xs tabular-nums text-muted-foreground">{dates.startDate} ~ {dates.endDate}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <PeriodFilter
                    periodType={periodType}
                    year={year}
                    month={month}
                    quarter={quarter}
                    weekStart={weekStart}
                    onPeriodTypeChange={(t) => updateDashboardParams({ period: t })}
                    onYearChange={(value) => updateDashboardParams({ year: String(value) })}
                    onMonthChange={(value) => updateDashboardParams({ month: String(value) })}
                    onQuarterChange={(value) => updateDashboardParams({ quarter: String(value) })}
                    onWeekStartChange={(value) => updateDashboardParams({ weekStart: value })}
                  />
                  <Button variant="outline" size="sm" className="rounded-full" onClick={handleExport} disabled={!data}>
                    <FileDown className="mr-1.5 size-3.5" />
                    导出
                  </Button>
                </div>
              </div>
              {/* Metric cards */}
              <MetricCards dashboard={data} />

              {/* Summary stats row */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  {
                    label: "平均毛利率",
                    value: data.projects.length > 0
                      ? (data.projects.reduce((s, p) => s + (p.gross_margin || 0), 0) / data.projects.length).toFixed(1) + "%"
                      : "—",
                  },
                  {
                    label: "人均工日",
                    value: data.totalPeople > 0
                      ? (data.totalLaborHours / data.totalPeople).toFixed(1)
                      : "—",
                  },
                  {
                    label: "回款率",
                    value: (() => {
                      const t = data.projects.reduce((s, p) => s + (p.contract_amount || 0), 0);
                      const r = data.projects.reduce((s, p) => s + (p.received_amount || 0), 0);
                      return t > 0 ? ((r / t) * 100).toFixed(1) + "%" : "—";
                    })(),
                  },
                  {
                    label: "人力成本占比",
                    value: (() => {
                      const r = data.projects.reduce((s, p) => s + (p.received_amount || 0), 0);
                      return r > 0 ? (((data.totalLaborCost || 0) / r) * 100).toFixed(1) + "%" : "—";
                    })(),
                  },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border border-border bg-card px-4 py-3">
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                    <strong className="block text-xl font-bold tabular-nums mt-1">{item.value}</strong>
                  </div>
                ))}
              </div>

              {/* Project detail table */}
              <DashboardTable
                projects={data.projects}
                startDate={dates.startDate}
                endDate={dates.endDate}
              />
            </section>
          )}

          {/* ---- Analytics Tab ---- */}
          {activeTab === "analytics" && (
            <section aria-label="分析">
              <DashboardAnalysisWorkbench
                startDate={dates.startDate}
                endDate={dates.endDate}
                periodType={periodType}
                year={year}
                month={month}
                quarter={quarter}
                weekStart={weekStart}
                onPeriodTypeChange={(t) => updateDashboardParams({ period: t })}
                onYearChange={(value) => updateDashboardParams({ year: String(value) })}
                onMonthChange={(value) => updateDashboardParams({ month: String(value) })}
                onQuarterChange={(value) => updateDashboardParams({ quarter: String(value) })}
                onWeekStartChange={(value) => updateDashboardParams({ weekStart: value })}
              />
            </section>
          )}
          </>
          )}
        </div>
      )}
    </div>
  );
}
