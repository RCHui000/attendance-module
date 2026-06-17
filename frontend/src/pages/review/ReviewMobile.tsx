import { useMemo } from "react";
import { ReviewMobileCards } from "@/components/review/mobile/ReviewMobileCards";
import { Button } from "@/components/ui/button";
import type { ApprovalTasks } from "@/types/approval";
import { RefreshCw } from "lucide-react";

interface ReviewMobileProps {
  data?: ApprovalTasks;
  isLoading: boolean;
  isError: boolean;
  approvalTab: "pending" | "reviewed";
  onTabChange: (tab: "pending" | "reviewed") => void;
  onRefresh: () => void;
}

export function ReviewMobile({
  data,
  isLoading,
  isError,
  approvalTab,
  onTabChange,
  onRefresh,
}: ReviewMobileProps) {
  const counts = useMemo(
    () => ({
      pending: (data?.timesheets.length || 0) + (data?.overtime.length || 0),
      reviewed: (data?.reviewed.length || 0) + (data?.overtimeReviewed.length || 0),
    }),
    [data],
  );

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-background pb-24">
      <div className="sticky top-0 z-20 -mx-3 border-b border-border bg-background/95 px-3 py-3 backdrop-blur supports-backdrop-filter:bg-background/80">
        <div className="flex items-center justify-end">
          <Button variant="outline" size="icon-sm" onClick={onRefresh} aria-label="刷新审批任务">
            <RefreshCw className="size-4" />
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-card p-1">
          {(["pending", "reviewed"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`min-h-10 rounded-md px-3 text-sm font-medium transition-colors ${
                approvalTab === tab ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground"
              }`}
              onClick={() => onTabChange(tab)}
            >
              {tab === "pending" ? "待审核" : "已审核"}
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
          数据加载失败，请刷新重试
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
