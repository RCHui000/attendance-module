import { useState } from "react";
import { useApprovalTasks } from "@/hooks/useApprovals";
import { useAppStore } from "@/stores/appStore";
import { useAuthStore } from "@/stores/authStore";
import { ApprovalTable } from "@/components/review/ApprovalTable";
import { ApprovalFlowConfig } from "@/components/review/ApprovalFlowConfig";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export default function ReviewPage() {
  const { currentWeek, approvalTab, setApprovalTab } = useAppStore();
  const { isAdmin } = useAuthStore();
  const [pageTab, setPageTab] = useState<"tasks" | "templates">("tasks");
  const { data, isLoading, isError, refetch } = useApprovalTasks(currentWeek);

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
        <Button variant="outline" size="sm" onClick={() => refetch()}>
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
        <ApprovalTable data={data} approvalTab={approvalTab} onTabChange={setApprovalTab} />
      )}
    </div>
  );
}
