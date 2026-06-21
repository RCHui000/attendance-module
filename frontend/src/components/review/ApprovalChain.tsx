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
  cancelled: "已作废",
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
  cancelled: "已作废",
  skipped: "已跳过",
};

const actionLabel: Record<string, string> = {
  approve: "通过",
  approved: "通过",
  reject: "退回",
  rejected: "退回",
  delegated: "转交",
  skipped: "跳过",
  cancelled: "作废",
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

function nodeTitle(node: ApprovalChainNode) {
  return node.node_name;
}

function routeRefreshReason(comment?: string | null) {
  const value = String(comment || "");
  if (!value) return "";
  if (value.includes("Route refreshed") || value.includes("history_repair")) return "负责人变更/路线刷新";
  if (value.includes("Auto-collapsed")) return "同一审批人自动折叠后的旧路线";
  return value;
}

function blockingLabel(node: ApprovalChainNode) {
  return node.blocking_nodes.map((item) => item.node_name).join("、");
}

function nodeHint(node: ApprovalChainNode, nodeNumber: string, blockingNodes: string) {
  if (node.node_status === "rejected") return `退回流向：${nodeNumber} ${nodeTitle(node)} -> 节点1 待提交`;
  if (node.node_status === "cancelled") return "历史路线已作废，不参与当前审批";
  if (node.node_status === "waiting" && blockingNodes) return "前序未完成，暂不进入待办";
  if (node.node_status === "active") return "当前处理节点";
  return "";
}

function ChainCard({
  node,
  nodeNumber,
  muted = false,
}: {
  node: ApprovalChainNode;
  nodeNumber: string;
  muted?: boolean;
}) {
  const assignees = fallbackAssignees(node);
  const blockingNodes = blockingLabel(node);
  const hint = nodeHint(node, nodeNumber, blockingNodes);
  const reason = node.node_status === "cancelled" ? routeRefreshReason(node.comment) : "";

  return (
    <div
      className={cn(
        "relative w-[240px] rounded-md border bg-background p-2.5 text-xs",
        node.node_status === "active" && "border-primary/70 shadow-sm ring-2 ring-primary/10",
        node.node_status === "rejected" && "border-destructive/50",
        muted && "bg-muted/20 text-muted-foreground",
      )}
    >
      <div className="absolute -left-1 top-3 size-2 rounded-full bg-border" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block text-sm leading-5 text-foreground">
            {nodeNumber}：{nodeTitle(node)}
          </strong>
          <span className="mt-0.5 block leading-5 text-muted-foreground">{node.node_name}</span>
        </div>
        <Badge variant={statusVariant[node.node_status] || "secondary"} className="shrink-0 text-[10px]">
          {statusLabel[node.node_status] || node.node_status}
        </Badge>
      </div>
      <ul className="mt-2 space-y-1.5">
        {assignees.map((assignee) => {
          const assigneeName = assignee.assignee_name || `员工 ${assignee.assignee_user_id}`;
          const projectLabel = [assignee.project_code, assignee.project_name].filter(Boolean).join(" ");
          const actedAt = formatDateTime(assignee.acted_at);
          const statusText = assigneeStatusLabel[assignee.status] || assignee.status;
          const nodeStatusText = assignee.node_status
            ? statusLabel[assignee.node_status] || assignee.node_status
            : "";
          const actionText = assignee.action ? actionLabel[assignee.action] || assignee.action : "";
          const key = `${node.node_id}-${assignee.node_id || assignee.assignee_user_id}-${assignee.status}-${assignee.acted_at || ""}`;

          return (
            <li key={key} className="rounded-sm bg-muted/40 px-2 py-1.5 leading-5">
              {projectLabel ? (
                <div className="mb-1 text-muted-foreground">{projectLabel}</div>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-foreground">{assigneeName}</span>
                <span className="text-muted-foreground">{statusText}</span>
                {nodeStatusText && nodeStatusText !== statusText ? (
                  <span className="text-muted-foreground">{nodeStatusText}</span>
                ) : null}
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
      {blockingNodes ? <p className="mt-2 leading-5 text-muted-foreground">等待：{blockingNodes}</p> : null}
      {reason ? <p className="mt-2 leading-5 text-muted-foreground">作废原因：{reason}</p> : null}
      {hint ? <p className="mt-2 rounded-sm bg-muted/40 px-2 py-1 leading-5 text-muted-foreground">{hint}</p> : null}
      {node.comment && !reason ? (
        <p className="mt-2 line-clamp-2 leading-5 text-muted-foreground">{node.comment}</p>
      ) : null}
    </div>
  );
}

function Connector({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="flex w-8 items-center" aria-hidden="true">
      <div className="h-px w-full bg-border" />
    </div>
  );
}

export function ApprovalChain({ nodes = [] }: ApprovalChainProps) {
  if (!nodes.length) return null;

  const effectiveNodes = nodes.filter((node) => node.node_status !== "cancelled");
  const historicalNodes = nodes.filter((node) => node.node_status === "cancelled");
  const hasRejected = effectiveNodes.some((node) => node.node_status === "rejected");
  const submitHint = hasRejected ? "退回后需提交人修改并重新提交" : "提交后进入审批模板节点";

  return (
    <section
      aria-label="审批链路"
      className="mb-3 w-[calc(100vw-4rem)] max-w-full overflow-hidden rounded-md border border-border bg-card px-3 py-2.5"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="text-xs text-foreground">审批链路</strong>
        <span className="text-[11px] text-muted-foreground">
          模板链路 {effectiveNodes.length + 1} 个节点（含提交节点）
          {historicalNodes.length ? `；历史作废 ${historicalNodes.length} 个` : ""}
        </span>
        {hasRejected && (
          <span className="text-[11px] text-destructive">
            退回会回到节点1“待提交”，后续节点等待重新提交后再流转
          </span>
        )}
      </div>
      <p className="mb-2 text-[11px] leading-5 text-muted-foreground">
        节点来自当前周表绑定的审批模板；项目块、审批人和历史作废记录会归到对应模板节点下面，不再把项目块摊平成主链路。
      </p>
      <div className="max-w-full overflow-x-auto overscroll-x-contain pb-1">
        <ol className="flex min-w-max items-stretch">
          <li className="flex items-stretch">
            <div className="relative w-[240px] rounded-md border bg-background p-2.5 text-xs">
              <div className="absolute -left-1 top-3 size-2 rounded-full bg-border" />
              <div className="flex items-start justify-between gap-2">
                <strong className="min-w-0 text-sm leading-5 text-foreground">节点1：待提交</strong>
                <Badge variant={hasRejected ? "destructive" : "secondary"} className="shrink-0 text-[10px]">
                  {hasRejected ? "待重新提交" : "已提交"}
                </Badge>
              </div>
              <p className="mt-2 rounded-sm bg-muted/40 px-2 py-1.5 leading-5 text-muted-foreground">
                {submitHint}
              </p>
            </div>
            <Connector show={effectiveNodes.length > 0} />
          </li>
          {effectiveNodes.map((node, index) => (
            <li className="flex items-stretch" key={node.node_id}>
              <ChainCard node={node} nodeNumber={`节点${index + 2}`} />
              <Connector show={index < effectiveNodes.length - 1} />
            </li>
          ))}
        </ol>
      </div>
      {historicalNodes.length ? (
        <div className="mt-3 border-t border-border pt-2">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <strong className="text-xs text-muted-foreground">历史路线（已作废，不参与当前审批）</strong>
            <span className="text-[11px] text-muted-foreground">
              这些节点保留用于审计，通常来自负责人变更、路线刷新或历史数据修复。
            </span>
          </div>
          <div className="max-w-full overflow-x-auto overscroll-x-contain pb-1">
            <ol className="flex min-w-max items-stretch">
              {historicalNodes.map((node, index) => (
                <li className="flex items-stretch" key={node.node_id}>
                  <ChainCard node={node} nodeNumber={`历史${index + 1}`} muted />
                  <Connector show={index < historicalNodes.length - 1} />
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </section>
  );
}
