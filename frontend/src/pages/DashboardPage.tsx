import { useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboard, useDashboardAnalysis } from "@/hooks/useProjects";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { MetricCards } from "@/components/dashboard/MetricCards";
import { DashboardTable } from "@/components/dashboard/DashboardTable";
import { DashboardAnalysisWorkbench } from "@/components/dashboard/DashboardAnalysisWorkbench";
import { DashboardMobile } from "@/pages/dashboard/DashboardMobile";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import { computePeriodDates, type PeriodType } from "@/components/dashboard/periodUtils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, RefreshBadge, SkeletonBlock } from "@/components/ui/feedback";
import { isoDate, mondayOfWeek } from "@/utils/dates";
import { formatMoney } from "@/utils/dates";
import { buildAnalysisEntities, type AnalysisEntity, type AnalysisView } from "@/components/dashboard/analysisModel";
import { FileDown, MoveRight } from "lucide-react";

type DashboardTab = "overview" | "analytics";

function OverviewInsightCard({
  title,
  entity,
  emptyText,
  onOpen,
}: {
  title: string;
  entity: AnalysisEntity | null;
  emptyText: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!entity}
      onClick={onOpen}
      className="group rounded-lg border border-border bg-card p-4 text-left shadow-app transition-[border-color,background-color,box-shadow] hover:border-primary/40 hover:bg-row-hover disabled:cursor-default disabled:hover:border-border disabled:hover:bg-card"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        {entity && <MoveRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
      </div>
      {entity ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <strong className="truncate text-base">{entity.title}</strong>
            {entity.badge && <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{entity.badge}</span>}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{entity.subtitle}</p>
          <div className="mt-4 flex items-end justify-between gap-3">
            <span className="text-xs text-muted-foreground">期间工日</span>
            <strong className="text-xl tabular-nums">{entity.labor_days.toFixed(1)}</strong>
          </div>
        </>
      ) : (
        <div className="flex h-[88px] items-center text-sm text-muted-foreground">{emptyText}</div>
      )}
    </button>
  );
}

function DashboardOverviewSkeleton() {
  return (
    <section aria-label="数据看板加载中" className="space-y-5">
      <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-app">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-5 w-24" />
            <SkeletonBlock className="h-3 w-44" />
          </div>
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-8 w-36 rounded-full" />
            <SkeletonBlock className="h-8 w-36 rounded-full" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border bg-card px-4 py-4 shadow-app">
            <SkeletonBlock className="h-4 w-20" />
            <SkeletonBlock className="mt-8 h-8 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border bg-card px-4 py-3">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="mt-3 h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-border bg-card shadow-app">
        <div className="border-b border-border px-4 py-3">
          <SkeletonBlock className="h-4 w-36" />
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonBlock key={index} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </section>
  );
}

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

  const { data, isLoading, isFetching, isError } = useDashboard(
    dates.startDate,
    dates.endDate,
  );
  const analysisGrain = periodType === "week" ? "week" : "month";
  const {
    data: analysisData,
    isFetching: isAnalysisFetching,
    isError: isAnalysisError,
  } = useDashboardAnalysis(dates.startDate, dates.endDate, analysisGrain);
  const showInitialLoading = isLoading && !data;
  const showBackgroundRefresh = isFetching && !!data;
  const overviewInsights = useMemo(() => {
    if (!analysisData) {
      return {
        project: null,
        employee: null,
        department: null,
      };
    }
    return {
      project: buildAnalysisEntities(analysisData, "project")[0] || null,
      employee: buildAnalysisEntities(analysisData, "employee")[0] || null,
      department: buildAnalysisEntities(analysisData, "department")[0] || null,
    };
  }, [analysisData]);

  const jumpToAnalysis = useCallback(
    (view: AnalysisView, entity: AnalysisEntity | null) => {
      if (!entity) return;
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("tab", "analytics");
        next.set("analysisView", view);
        next.delete("projectId");
        next.delete("employeeId");
        next.delete("department");
        if (view === "employee") next.set("employeeId", entity.id);
        else if (view === "department") next.set("department", entity.id);
        else next.set("projectId", entity.id);
        return next;
      });
    },
    [setSearchParams],
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
      <div role="tabpanel" className="animate-fade-in">
        {isMobile ? (
          showInitialLoading ? (
            <DashboardOverviewSkeleton />
          ) : isError && !data ? (
            <ErrorState title="数据加载失败" description="请稍后重试，或检查网络连接。" />
          ) : data ? (
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
          ) : null
        ) : (
          <>
          {/* ---- Overview Tab ---- */}
          {activeTab === "overview" && (
            showInitialLoading ? (
              <DashboardOverviewSkeleton />
            ) : isError && !data ? (
              <ErrorState title="数据加载失败" description="请稍后重试，或检查网络连接。" />
            ) : data ? (
            <section aria-label="总览" className="space-y-5">
              {isError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
                  数据刷新失败，当前显示的是上一次可用数据。
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-app">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold">经营驾驶舱</h2>
                    <RefreshBadge show={showBackgroundRefresh || isAnalysisFetching} />
                  </div>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {dates.startDate} ~ {dates.endDate} · 快速判断资金、工日和异常线索
                  </p>
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

              <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5 max-[1180px]:grid-cols-1">
                <Card className="rounded-lg p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">经营状态</h2>
                      <p className="text-xs text-muted-foreground">用少量指标判断当前周期是否值得下钻</p>
                    </div>
                    {isAnalysisError && (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                        线索刷新失败
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {[
                      {
                        label: "平均毛利率",
                        value: data.projects.length > 0
                          ? `${(data.projects.reduce((s, p) => s + (p.gross_margin || 0), 0) / data.projects.length).toFixed(1)}%`
                          : "—",
                      },
                      {
                        label: "人均工日",
                        value: data.totalPeople > 0 ? (data.totalLaborHours / data.totalPeople).toFixed(1) : "—",
                      },
                      {
                        label: "回款率",
                        value: (() => {
                          const contract = data.projects.reduce((s, p) => s + (p.contract_amount || 0), 0);
                          const received = data.projects.reduce((s, p) => s + (p.received_amount || 0), 0);
                          return contract > 0 ? `${((received / contract) * 100).toFixed(1)}%` : "—";
                        })(),
                      },
                      {
                        label: "人力成本占比",
                        value: (() => {
                          const received = data.projects.reduce((s, p) => s + (p.received_amount || 0), 0);
                          return received > 0 ? `${(((data.totalLaborCost || 0) / received) * 100).toFixed(1)}%` : "—";
                        })(),
                      },
                    ].map((item) => (
                      <div key={item.label} className="rounded-md border border-border bg-muted/20 px-4 py-3">
                        <span className="text-xs text-muted-foreground">{item.label}</span>
                        <strong className="mt-1 block text-xl font-bold tabular-nums">{item.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 max-[900px]:grid-cols-1">
                    <div className="rounded-md bg-muted/20 px-4 py-3">
                      <span className="text-xs text-muted-foreground">资金沉淀</span>
                      <strong className="mt-1 block text-lg tabular-nums">
                        {formatMoney(data.projects.reduce((sum, project) => sum + (project.receivable_amount || 0), 0))}
                      </strong>
                    </div>
                    <div className="rounded-md bg-muted/20 px-4 py-3">
                      <span className="text-xs text-muted-foreground">本期工日</span>
                      <strong className="mt-1 block text-lg tabular-nums">{data.totalLaborHours.toFixed(1)}</strong>
                    </div>
                    <div className="rounded-md bg-muted/20 px-4 py-3">
                      <span className="text-xs text-muted-foreground">活跃人员</span>
                      <strong className="mt-1 block text-lg tabular-nums">{data.totalPeople}</strong>
                    </div>
                  </div>
                </Card>

                <Card className="rounded-lg p-4">
                  <div className="mb-4">
                    <h2 className="text-sm font-semibold">下钻入口</h2>
                    <p className="text-xs text-muted-foreground">点击线索进入分析台对应视角</p>
                  </div>
                  <div className="space-y-3">
                    <OverviewInsightCard
                      title="投入最高项目"
                      entity={overviewInsights.project}
                      emptyText="暂无项目线索"
                      onOpen={() => jumpToAnalysis("project", overviewInsights.project)}
                    />
                    <OverviewInsightCard
                      title="负荷最高人员"
                      entity={overviewInsights.employee}
                      emptyText="暂无人员线索"
                      onOpen={() => jumpToAnalysis("employee", overviewInsights.employee)}
                    />
                    <OverviewInsightCard
                      title="投入最高部门"
                      entity={overviewInsights.department}
                      emptyText="暂无部门线索"
                      onOpen={() => jumpToAnalysis("department", overviewInsights.department)}
                    />
                  </div>
                </Card>
              </div>

              {/* Project detail table */}
              <DashboardTable
                projects={data.projects}
                startDate={dates.startDate}
                endDate={dates.endDate}
              />
            </section>
            ) : null
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
    </div>
  );
}
