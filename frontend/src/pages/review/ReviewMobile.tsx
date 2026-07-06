import { useMemo } from "react";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import { ReviewMobileCards } from "@/components/review/mobile/ReviewMobileCards";
import { ErrorState, RefreshBadge, SkeletonBlock } from "@/components/ui/feedback";
import type { PeriodType } from "@/components/dashboard/periodUtils";
import type { ApprovalTasks } from "@/types/approval";

interface ReviewMobileProps {
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

export function ReviewMobile({
  data,
  isLoading,
  isFetching,
  isError,
  approvalTab,
  onTabChange,
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
}: ReviewMobileProps) {
  const counts = useMemo(
    () => ({
      pending: (data?.timesheets.length || 0) + (data?.overtime.length || 0),
      reviewed: (data?.reviewed.length || 0) + (data?.overtimeReviewed.length || 0),
    }),
    [data],
  );
  const showInitialLoading = isLoading && !data;
  const showRefreshError = isError && !!data;

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-background pb-24">
      <div className="sticky top-0 z-20 -mx-3 border-b border-border bg-background/95 px-3 py-3 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-card p-1">
          {(["pending", "reviewed"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`min-h-10 rounded-md px-3 text-sm font-medium transition-colors ${
                approvalTab === tab ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground"
              }`}
              onClick={() => onTabChange(tab)}
            >
              {tab === "pending" ? "待审批" : "已审核"}
              <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                {counts[tab]}
              </span>
            </button>
          ))}
        </div>
        <RefreshBadge show={isFetching && !!data} />
        {approvalTab === "reviewed" && (
          <div className="mt-3 overflow-x-auto pb-1">
            <PeriodFilter
              periodType={reviewPeriodType}
              year={reviewYear}
              month={reviewMonth}
              quarter={reviewQuarter}
              weekStart={reviewWeekStart}
              onPeriodTypeChange={onReviewPeriodTypeChange}
              onYearChange={onReviewYearChange}
              onMonthChange={onReviewMonthChange}
              onQuarterChange={onReviewQuarterChange}
              onWeekStartChange={onReviewWeekStartChange}
            />
          </div>
        )}
      </div>

      {showInitialLoading && (
        <ReviewMobileSkeleton />
      )}

      {isError && !data && (
        <ErrorState title="审批数据加载失败" description="请稍后重试，或检查网络连接。" />
      )}

      {data && (
        <>
          {showRefreshError && (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              数据刷新失败，当前显示的是上一次可用数据。
            </div>
          )}
          <ReviewMobileCards
            data={data}
            approvalTab={approvalTab}
          />
        </>
      )}
    </div>
  );
}

function ReviewMobileSkeleton() {
  return (
    <section aria-label="审批中心加载中" className="space-y-3 pt-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-32" />
              <SkeletonBlock className="h-3 w-44" />
            </div>
            <SkeletonBlock className="h-5 w-14 rounded-full" />
          </div>
          <SkeletonBlock className="mt-4 h-8 w-full rounded-full" />
        </div>
      ))}
    </section>
  );
}
