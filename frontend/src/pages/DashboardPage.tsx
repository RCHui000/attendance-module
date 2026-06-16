import { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboard } from "@/hooks/useProjects";
import { MetricCards } from "@/components/dashboard/MetricCards";
import { DashboardTable } from "@/components/dashboard/DashboardTable";
import { BiPerspectiveTab } from "@/components/dashboard/BiPerspectiveTab";
import {
  PeriodFilter,
  computePeriodDates,
  type PeriodType,
} from "@/components/dashboard/PeriodFilter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RefreshCw,
  FileDown,
  LayoutDashboard,
  TrendingUp,
} from "lucide-react";

type DashboardTab = "overview" | "analytics";

const TAB_OPTIONS: { value: DashboardTab; label: string; icon: React.ReactNode }[] = [
  { value: "overview", label: "总览", icon: <LayoutDashboard className="size-4" /> },
  { value: "analytics", label: "分析", icon: <TrendingUp className="size-4" /> },
];

export default function DashboardPage() {
  const now = new Date();
  const [searchParams, setSearchParams] = useSearchParams();
  const periodParam = searchParams.get("period");
  const yearParam = Number(searchParams.get("year"));
  const monthParam = Number(searchParams.get("month"));
  const quarterParam = Number(searchParams.get("quarter"));
  const tabParam = searchParams.get("tab");

  const periodType: PeriodType =
    periodParam === "month" || periodParam === "quarter" || periodParam === "year"
      ? periodParam
      : "year";
  const year = Number.isInteger(yearParam) && yearParam > 2000 ? yearParam : now.getFullYear();
  const month = Number.isInteger(monthParam) && monthParam >= 1 && monthParam <= 12 ? monthParam : now.getMonth() + 1;
  const quarter =
    Number.isInteger(quarterParam) && quarterParam >= 1 && quarterParam <= 4
      ? quarterParam
      : Math.floor(now.getMonth() / 3) + 1;
  const activeTab: DashboardTab = tabParam === "analytics" ? "analytics" : "overview";

  const updateDashboardParams = useCallback(
    (updates: Partial<Record<"period" | "year" | "month" | "quarter" | "tab", string>>) => {
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
    () => computePeriodDates(periodType, year, month, quarter),
    [periodType, year, month, quarter],
  );

  const { data, isLoading, isError, refetch } = useDashboard(
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
    <div>
      {/* Tab row: tabs on left, PeriodFilter + actions on right */}
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        {/* Tabs */}
        <nav
          className="flex items-center gap-1"
          role="tablist"
          aria-label="看板视图切换"
        >
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.value}
              className={cn(
                "inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg transition-colors",
                "hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
                activeTab === tab.value
                  ? "bg-muted text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
              onClick={() => updateDashboardParams({ tab: tab.value })}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>

        {/* PeriodFilter + actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <PeriodFilter
            periodType={periodType}
            year={year}
            month={month}
            quarter={quarter}
            onPeriodTypeChange={(t) => updateDashboardParams({ period: t })}
            onYearChange={(value) => updateDashboardParams({ year: String(value) })}
            onMonthChange={(value) => updateDashboardParams({ month: String(value) })}
            onQuarterChange={(value) => updateDashboardParams({ quarter: String(value) })}
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {dates.startDate} ~ {dates.endDate}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="size-3.5 mr-1.5" />
            刷新
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!data}>
            <FileDown className="size-3.5 mr-1.5" />
            导出
          </Button>
        </div>
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <p className="text-sm text-muted-foreground">加载中…</p>
        </div>
      )}
      {isError && (
        <div className="flex items-center justify-center py-24">
          <p className="text-sm text-destructive">数据加载失败，请点击刷新重试</p>
        </div>
      )}

      {/* Data loaded */}
      {data && (
        <div role="tabpanel" className="animate-fade-in">
          {/* ---- Overview Tab ---- */}
          {activeTab === "overview" && (
            <section aria-label="总览" className="space-y-5">
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
              <BiPerspectiveTab
                startDate={dates.startDate}
                endDate={dates.endDate}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
