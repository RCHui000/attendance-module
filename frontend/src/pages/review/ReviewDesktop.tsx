import { useState } from "react";
import { ApprovalFlowConfig } from "@/components/review/ApprovalFlowConfig";
import { ApprovalTable } from "@/components/review/ApprovalTable";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/authStore";
import type { ApprovalTasks } from "@/types/approval";
import { RefreshCw } from "lucide-react";

interface ReviewDesktopProps {
  data?: ApprovalTasks;
  isLoading: boolean;
  isError: boolean;
  approvalTab: "pending" | "reviewed";
  onTabChange: (tab: "pending" | "reviewed") => void;
  onRefresh: () => void;
}

export function ReviewDesktop({
  data,
  isLoading,
  isError,
  approvalTab,
  onTabChange,
  onRefresh,
}: ReviewDesktopProps) {
  const { isAdmin } = useAuthStore();
  const [pageTab, setPageTab] = useState<"tasks" | "templates">("tasks");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border p-0.5">
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-sm ${pageTab === "tasks" ? "bg-muted font-medium" : "text-muted-foreground"}`}
            onClick={() => setPageTab("tasks")}
          >
            审批任务
          </button>
          {isAdmin && (
            <button
              type="button"
              className={`rounded-md px-3 py-1 text-sm ${pageTab === "templates" ? "bg-muted font-medium" : "text-muted-foreground"}`}
              onClick={() => setPageTab("templates")}
            >
              审批流配置
            </button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="mr-1 size-3.5" />
          刷新
        </Button>
      </div>

      {pageTab === "templates" && isAdmin && <ApprovalFlowConfig />}

      {pageTab === "tasks" && isLoading && (
        <div className="py-16 text-center text-sm text-muted-foreground">加载中...</div>
      )}

      {pageTab === "tasks" && isError && (
        <div className="py-16 text-center text-sm text-destructive">
          数据加载失败，请点击刷新重试
        </div>
      )}

      {pageTab === "tasks" && data && (
        <ApprovalTable data={data} approvalTab={approvalTab} onTabChange={onTabChange} />
      )}
    </div>
  );
}
