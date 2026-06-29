import { useState } from "react";
import { ApprovalFlowConfig } from "@/components/review/ApprovalFlowConfig";
import { ApprovalTable } from "@/components/review/ApprovalTable";
import { SegmentedPill } from "@/components/ui/segmented-pill";
import { ErrorState, SkeletonBlock } from "@/components/ui/feedback";
import { useAuthStore } from "@/stores/authStore";
import type { PeriodType } from "@/components/dashboard/periodUtils";
import type { ApprovalTasks } from "@/types/approval";

interface ReviewDesktopProps {
  data?: ApprovalTasks;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  approvalTab: "pending" | "reviewed";
  onTabChange: (tab: "pending" | "reviewed") => void;
  currentWeek: string;
  onWeekChange: (week: string) => void;
  reviewPeriodType: PeriodType;
  onReviewPeriodTypeChange: (type: PeriodType) => void;
  reviewYear: number;
  onReviewYearChange: (year: number) => void;
  reviewMonth: number;
  onReviewMonthChange: (month: number) => void;
  reviewQuarter: number;
  onReviewQuarterChange: (quarter: number) => void;
  reviewWeekStart: string;
  onReviewWeekStartChange: (week: string) => void;
}

export function ReviewDesktop({
  data,
  isLoading,
  isFetching,
  isError,
  approvalTab,
  onTabChange,
  currentWeek,
  onWeekChange,
  reviewPeriodType,
  onReviewPeriodTypeChange,
  reviewYear,
  onReviewYearChange,
  reviewMonth,
  onReviewMonthChange,
  reviewQuarter,
  onReviewQuarterChange,
  reviewWeekStart,
  onReviewWeekStartChange,
}: ReviewDesktopProps) {
  const { canAccess } = useAuthStore();
  const [pageTab, setPageTab] = useState<"tasks" | "templates">("tasks");
  const canReadApprovalConfig = canAccess("approval_config", "read");
  const canWriteApprovalConfig = canAccess("approval_config", "write");
  const pageTabs = [
    { value: "tasks" as const, label: "审批任务" },
    ...(canReadApprovalConfig ? [{ value: "templates" as const, label: "审批流配置" }] : []),
  ];
  const visiblePageTab = pageTab === "templates" && !canReadApprovalConfig ? "tasks" : pageTab;
  const showInitialLoading = isLoading && !data;
  const showRefreshError = isError && !!data;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <SegmentedPill
          value={visiblePageTab}
          items={pageTabs}
          onChange={setPageTab}
          ariaLabel="审批页面视图"
        />
      </div>

      {visiblePageTab === "templates" && canReadApprovalConfig && (
        <ApprovalFlowConfig canWrite={canWriteApprovalConfig} />
      )}

      {visiblePageTab === "tasks" && showInitialLoading && (
        <ReviewTasksSkeleton />
      )}

      {visiblePageTab === "tasks" && isError && !data && (
        <ErrorState title="审批数据加载失败" description="请稍后重试，或检查网络连接。" />
      )}

      {visiblePageTab === "tasks" && data && (
        <>
          {showRefreshError && (
            <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">
              数据刷新失败，当前显示的是上一次可用数据。
            </div>
          )}
          <ApprovalTable
            data={data}
            isFetching={isFetching}
            approvalTab={approvalTab}
            onTabChange={onTabChange}
            currentWeek={currentWeek}
            onWeekChange={onWeekChange}
            reviewPeriodType={reviewPeriodType}
            onReviewPeriodTypeChange={onReviewPeriodTypeChange}
            reviewYear={reviewYear}
            onReviewYearChange={onReviewYearChange}
            reviewMonth={reviewMonth}
            onReviewMonthChange={onReviewMonthChange}
            reviewQuarter={reviewQuarter}
            onReviewQuarterChange={onReviewQuarterChange}
            reviewWeekStart={reviewWeekStart}
            onReviewWeekStartChange={onReviewWeekStartChange}
          />
        </>
      )}
    </div>
  );
}

function ReviewTasksSkeleton() {
  return (
    <section aria-label="审批中心加载中" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <SkeletonBlock className="h-10 w-44 rounded-full" />
        <SkeletonBlock className="h-9 w-72 rounded-full" />
      </div>
      <div className="rounded-lg border border-border bg-card shadow-app">
        <div className="border-b border-border px-4 py-3">
          <SkeletonBlock className="h-4 w-40" />
        </div>
        <div className="space-y-3 p-4">
          {Array.from({ length: 7 }).map((_, index) => (
            <SkeletonBlock key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-4 shadow-app">
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="mt-4 h-16 w-full" />
      </div>
    </section>
  );
}
