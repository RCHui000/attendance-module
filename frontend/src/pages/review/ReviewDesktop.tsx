import { useState } from "react";
import { ApprovalFlowConfig } from "@/components/review/ApprovalFlowConfig";
import { ApprovalTable } from "@/components/review/ApprovalTable";
import { SegmentedPill } from "@/components/ui/segmented-pill";
import { useAuthStore } from "@/stores/authStore";
import type { ApprovalTasks } from "@/types/approval";

interface ReviewDesktopProps {
  data?: ApprovalTasks;
  isLoading: boolean;
  isError: boolean;
  approvalTab: "pending" | "reviewed";
  onTabChange: (tab: "pending" | "reviewed") => void;
}

export function ReviewDesktop({
  data,
  isLoading,
  isError,
  approvalTab,
  onTabChange,
}: ReviewDesktopProps) {
  const { isAdmin } = useAuthStore();
  const [pageTab, setPageTab] = useState<"tasks" | "templates">("tasks");
  const pageTabs = [
    { value: "tasks" as const, label: "审批任务" },
    ...(isAdmin ? [{ value: "templates" as const, label: "审批流配置" }] : []),
  ];

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <SegmentedPill
          value={pageTab}
          items={pageTabs}
          onChange={setPageTab}
          ariaLabel="审批页面视图"
        />
      </div>

      {pageTab === "templates" && isAdmin && <ApprovalFlowConfig />}

      {pageTab === "tasks" && isLoading && (
        <div className="py-16 text-center text-sm text-muted-foreground">加载中...</div>
      )}

      {pageTab === "tasks" && isError && (
        <div className="py-16 text-center text-sm text-destructive">
          数据加载失败，请稍后重试
        </div>
      )}

      {pageTab === "tasks" && data && (
        <ApprovalTable data={data} approvalTab={approvalTab} onTabChange={onTabChange} />
      )}
    </div>
  );
}
