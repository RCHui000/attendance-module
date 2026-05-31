import { useApprovalTasks } from "@/hooks/useApprovals";
import { useAppStore } from "@/stores/appStore";
import { ApprovalTable } from "@/components/review/ApprovalTable";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export default function ReviewPage() {
  const { currentWeek, approvalTab, setApprovalTab } = useAppStore();
  const { data, isLoading, isError, refetch } = useApprovalTasks(currentWeek);

  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-4">
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-3.5 mr-1" />
          刷新
        </Button>
      </div>

      {isLoading && (
        <div className="py-16 text-center text-sm text-muted-foreground">
          加载中…
        </div>
      )}

      {isError && (
        <div className="py-16 text-center text-sm text-destructive">
          数据加载失败，请点击刷新重试
        </div>
      )}

      {data && (
        <ApprovalTable
          data={data}
          approvalTab={approvalTab}
          onTabChange={setApprovalTab}
        />
      )}
    </div>
  );
}
