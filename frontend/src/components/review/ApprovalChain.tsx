import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ApprovalChainAssignee, ApprovalChainNode } from "@/types/approval";

interface ApprovalChainProps {
  nodes?: ApprovalChainNode[];
}

const statusLabel: Record<string, string> = {
  waiting: "待审核",
  active: "审核中",
  approved: "已审核",
  rejected: "已退回",
  cancelled: "已取消/撤回",
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
  pending: "待审核",
  approved: "已审核",
  rejected: "已退回",
  cancelled: "已取消/撤回",
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

function nodeHint(node: ApprovalChainNode, blockingNodes: string) {
  if (node.node_status === "rejected") return `退回流向：${node.node_name} -> 节点1 待提交`;
  if (node.node_status === "waiting" && blockingNodes) return "前序未完成，暂不进入待办";
  if (node.node_status === "active") return "当前处理节点";
  return "";
}

export function ApprovalChain({ nodes = [] }: ApprovalChainProps) {
  if (!nodes.length) return null;
  const hasRejected = nodes.some((node) => node.node_status === "rejected");
  const submitHint = hasRejected ? "退回后需提交人修改并重新提交" : "提交后进入项目块审批";

  return (
    <section
      aria-label="审批链路"
      className="mb-3 w-[calc(100vw-4rem)] max-w-full overflow-hidden rounded-md border border-border bg-card px-3 py-2.5"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="text-xs text-foreground">审批链路</strong>
        <span className="text-[11px] text-muted-foreground">{nodes.length + 1} 个节点（含提交节点）</span>
        {hasRejected && (
          <span className="text-[11px] text-destructive">
            退回会回到节点1“待提交”，后续节点等待重新提交后再流转
          </span>
        )}
      </div>
      <p className="mb-2 text-[11px] leading-5 text-muted-foreground">
        节点多是因为周表按项目块生成审批：每个项目会按配置的项目负责人、成本负责人、部门负责人等角色形成节点；多个项目块会串联显示，不代表有 {nodes.length + 1} 级领导。
      </p>
      <div className="max-w-full overflow-x-auto overscroll-x-contain pb-1">
        <ol className="flex min-w-max items-stretch">
          <li className="flex items-stretch">
            <div className="relative w-[220px] rounded-md border bg-background p-2.5 text-xs">
              <div className="absolute -left-1 top-3 size-2 rounded-full bg-border" />
              <div className="flex items-start justify-between gap-2">
                <strong className="min-w-0 text-sm leading-5 text-foreground">
                  节点1：待提交
                </strong>
                <Badge variant={hasRejected ? "destructive" : "secondary"} className="shrink-0 text-[10px]">
                  {hasRejected ? "待重新提交" : "已提交"}
                </Badge>
              </div>
              <p className="mt-2 rounded-sm bg-muted/40 px-2 py-1.5 leading-5 text-muted-foreground">
                {submitHint}
              </p>
            </div>
            <div className="flex w-8 items-center" aria-hidden="true">
              <div className="h-px w-full bg-border" />
            </div>
          </li>
          {nodes.map((node, index) => {
          const assignees = fallbackAssignees(node);
          const blockingNodes = node.blocking_nodes.map((item) => item.node_name).join("、");
          const hint = nodeHint(node, blockingNodes);
          const nodeNumber = index + 2;

          return (
            <li className="flex items-stretch" key={node.node_id}>
              <div
                className={cn(
                  "relative w-[220px] rounded-md border bg-background p-2.5 text-xs",
                  node.node_status === "active" && "border-primary/70 shadow-sm ring-2 ring-primary/10",
                  node.node_status === "rejected" && "border-destructive/50",
                )}
              >
                <div className="absolute -left-1 top-3 size-2 rounded-full bg-border" />
                <div className="flex items-start justify-between gap-2">
                  <strong className="min-w-0 text-sm leading-5 text-foreground">
                    节点{nodeNumber}：{node.node_name}
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
                {hint ? (
                  <p className="mt-2 rounded-sm bg-muted/40 px-2 py-1 leading-5 text-muted-foreground">{hint}</p>
                ) : null}
                {node.comment ? (
                  <p className="mt-2 line-clamp-2 leading-5 text-muted-foreground">{node.comment}</p>
                ) : null}
              </div>
              {index < nodes.length - 1 && (
                <div className="flex w-8 items-center" aria-hidden="true">
                  <div className="h-px w-full bg-border" />
                </div>
              )}
            </li>
          );
          })}
        </ol>
      </div>
    </section>
  );
}
