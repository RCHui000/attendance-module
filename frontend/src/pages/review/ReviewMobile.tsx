import { useMemo } from "react";
import { ReviewMobileCards } from "@/components/review/mobile/ReviewMobileCards";
import type { ApprovalTasks } from "@/types/approval";

interface ReviewMobileProps {
  data?: ApprovalTasks;
  isLoading: boolean;
  isError: boolean;
  approvalTab: "pending" | "reviewed";
  onTabChange: (tab: "pending" | "reviewed") => void;
}

export function ReviewMobile({
  data,
  isLoading,
  isError,
  approvalTab,
  onTabChange,
}: ReviewMobileProps) {
  const counts = useMemo(
    () => ({
      pending: (data?.timesheets.length || 0) + (data?.inProgress.length || 0) + (data?.overtime.length || 0),
      reviewed: (data?.reviewed.length || 0) + (data?.overtimeReviewed.length || 0),
    }),
    [data],
  );

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
      </div>

      {isLoading && (
        <div className="py-16 text-center text-sm text-muted-foreground">加载中...</div>
      )}

      {isError && (
        <div className="py-16 text-center text-sm text-destructive">
          数据加载失败，请稍后重试
        </div>
      )}

      {data && !isLoading && !isError && (
        <ReviewMobileCards
          data={data}
          approvalTab={approvalTab}
        />
      )}
    </div>
  );
}
