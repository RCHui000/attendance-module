import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ApprovalChainNode } from "@/types/approval";

interface ApprovalChainProps {
  nodes?: ApprovalChainNode[];
}

const statusLabel: Record<string, string> = {
  waiting: "等待前序",
  active: "当前审批",
  approved: "已通过",
  rejected: "已拒绝",
  cancelled: "已取消",
  skipped: "已跳过",
};

const statusVariant: Record<string, "default" | "secondary" | "success" | "destructive" | "outline"> = {
  waiting: "outline",
  active: "default",
  approved: "success",
  rejected: "destructive",
  cancelled: "secondary",
  skipped: "secondary",
};

export function ApprovalChain({ nodes = [] }: ApprovalChainProps) {
  if (!nodes.length) return null;

  return (
    <section aria-label="审批链路" className="mb-3 rounded-md border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong className="text-xs text-muted-foreground">审批链路</strong>
      </div>
      <div className="grid gap-2 md:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
        {nodes.map((node) => {
          const pendingAssignees = node.assignees
            .filter((assignee) => assignee.status === "pending")
            .map((assignee) => assignee.assignee_name || `员工 ${assignee.assignee_user_id}`)
            .join("、");
          const blockingNodes = node.blocking_nodes.map((item) => item.node_name).join("、");

          return (
            <div
              className={cn(
                "min-h-[88px] rounded-md border bg-background p-2.5 text-xs",
                node.node_status === "active" && "border-primary/60 shadow-sm",
                node.node_status === "rejected" && "border-destructive/50",
              )}
              key={node.node_id}
            >
              <div className="flex items-start justify-between gap-2">
                <strong className="min-w-0 text-sm leading-5 text-foreground">
                  {node.node_name}
                </strong>
                <Badge variant={statusVariant[node.node_status] || "secondary"} className="shrink-0 text-[10px]">
                  {statusLabel[node.node_status] || node.node_status}
                </Badge>
              </div>
              {pendingAssignees ? (
                <p className="mt-2 leading-5 text-muted-foreground">当前待审批：{pendingAssignees}</p>
              ) : null}
              {blockingNodes ? (
                <p className="mt-2 leading-5 text-muted-foreground">等待：{blockingNodes}</p>
              ) : null}
              {node.comment ? (
                <p className="mt-2 line-clamp-2 leading-5 text-muted-foreground">{node.comment}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
