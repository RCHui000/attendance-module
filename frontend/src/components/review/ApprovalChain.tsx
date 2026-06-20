import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ApprovalChainAssignee, ApprovalChainNode } from "@/types/approval";

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

const assigneeStatusLabel: Record<string, string> = {
  pending: "待审批",
  approved: "已通过",
  rejected: "已拒绝",
  cancelled: "已取消",
  skipped: "已跳过",
};

const actionLabel: Record<string, string> = {
  approve: "通过",
  approved: "通过",
  reject: "退回",
  rejected: "退回",
  delegated: "转交",
  skipped: "跳过",
  cancelled: "取消",
};

function fallbackAssignees(node: ApprovalChainNode): ApprovalChainAssignee[] {
  if (node.assignees.length) return node.assignees;
  return [
    {
      assignee_user_id: 0,
      assignee_name: node.assignee_role || node.resolver_role || "待解析审批人",
      status: node.node_status === "active" ? "pending" : node.node_status,
      action: null,
      comment: null,
      acted_at: null,
    },
  ];
}

function formatDateTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ApprovalChain({ nodes = [] }: ApprovalChainProps) {
  if (!nodes.length) return null;

  return (
    <section aria-label="审批链路" className="mb-3 rounded-md border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong className="text-xs text-muted-foreground">审批链路</strong>
      </div>
      <div className="grid gap-2 md:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]">
        {nodes.map((node) => {
          const assignees = fallbackAssignees(node);
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
              <ul className="mt-2 space-y-1.5">
                {assignees.map((assignee) => {
                  const assigneeName = assignee.assignee_name || `员工 ${assignee.assignee_user_id}`;
                  const actedAt = formatDateTime(assignee.acted_at);
                  const statusText = assigneeStatusLabel[assignee.status] || assignee.status;
                  const actionText = assignee.action ? actionLabel[assignee.action] || assignee.action : "";
                  const key = `${node.node_id}-${assignee.assignee_user_id}-${assignee.status}-${assignee.acted_at || ""}`;

                  return (
                    <li key={key} className="rounded-sm bg-muted/40 px-2 py-1.5 leading-5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-foreground">{assigneeName}</span>
                        <span className="text-muted-foreground">{statusText}</span>
                        {actionText ? <span className="text-muted-foreground">{actionText}</span> : null}
                        {actedAt ? (
                          <time className="text-muted-foreground" dateTime={assignee.acted_at || undefined}>
                            {actedAt}
                          </time>
                        ) : null}
                      </div>
                      {assignee.comment ? (
                        <p className="mt-1 line-clamp-2 text-muted-foreground">{assignee.comment}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
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
