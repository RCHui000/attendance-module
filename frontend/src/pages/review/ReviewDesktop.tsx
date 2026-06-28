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
  currentWeek: string;
  onWeekChange: (week: string) => void;
}

export function ReviewDesktop({
  data,
  isLoading,
  isError,
  approvalTab,
  onTabChange,
  currentWeek,
  onWeekChange,
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

      {visiblePageTab === "tasks" && isLoading && (
        <div className="py-16 text-center text-sm text-muted-foreground">加载中...</div>
      )}

      {visiblePageTab === "tasks" && isError && (
        <div className="py-16 text-center text-sm text-destructive">
          数据加载失败，请稍后重试
        </div>
      )}

      {visiblePageTab === "tasks" && data && (
        <ApprovalTable
          data={data}
          approvalTab={approvalTab}
          onTabChange={onTabChange}
          currentWeek={currentWeek}
          onWeekChange={onWeekChange}
        />
      )}
    </div>
  );
}
