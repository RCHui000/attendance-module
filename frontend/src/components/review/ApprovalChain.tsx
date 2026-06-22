import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ApprovalChainAssignee, ApprovalChainNode } from "@/types/approval";

interface ApprovalChainProps {
  nodes?: ApprovalChainNode[];
}

const statusLabel: Record<string, string> = {
  waiting: "待审核",
  active: "审核中",
  pending: "待处理",
  approved: "已审核",
  rejected: "已退回",
  cancelled: "已作废",
  skipped: "已跳过",
  waiting_revision: "待修订",
  needs_revision: "需修订",
  needs_reapproval: "待重新审批",
};

const statusVariant: Record<string, "default" | "secondary" | "success" | "destructive" | "outline"> = {
  waiting: "outline",
  active: "default",
  pending: "outline",
  approved: "success",
  rejected: "destructive",
  cancelled: "secondary",
  skipped: "secondary",
  waiting_revision: "outline",
  needs_revision: "destructive",
  needs_reapproval: "outline",
};

const assigneeStatusLabel: Record<string, string> = {
  pending: "待审核",
  waiting: "待审核",
  active: "审核中",
  approved: "已审核",
  rejected: "已退回",
  cancelled: "已作废",
  skipped: "已跳过",
  waiting_revision: "待修订",
  needs_revision: "需修订",
  needs_reapproval: "待重新审批",
};

const actionLabel: Record<string, string> = {
  approve: "通过",
  approved: "通过",
  reject: "退回",
  rejected: "退回",
  delegate: "转交",
  delegated: "转交",
  skip: "跳过",
  skipped: "跳过",
  cancel: "作废",
  cancelled: "作废",
  submit: "提交",
  withdraw: "撤回",
  reopen: "重开",
};

const chainCardClass = "relative w-64 max-w-[calc(100vw-3.5rem)] shrink-0 rounded-md border bg-background p-2.5 text-xs sm:w-72";

function textValue(value?: number | string | null) {
  return String(value ?? "").trim();
}

function readableStatus(value?: string | null) {
  const raw = textValue(value);
  if (!raw) return "未记录";
  return statusLabel[raw] || assigneeStatusLabel[raw] || raw;
}

function readableAssigneeStatus(value?: string | null) {
  const raw = textValue(value);
  if (!raw) return "未记录";
  return assigneeStatusLabel[raw] || statusLabel[raw] || raw;
}

function readableAction(value?: string | null) {
  const raw = textValue(value);
  if (!raw) return "未操作";
  return actionLabel[raw] || raw;
}

function fallbackAssignees(node: ApprovalChainNode): ApprovalChainAssignee[] {
  if (Array.isArray(node.assignees) && node.assignees.length) return node.assignees;
  return [
    {
      node_id: null,
      node_name: node.node_name,
      node_status: node.node_status,
      project_id: null,
      project_code: node.project_code || "",
      project_name: node.project_name || "",
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
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
  return node.blocking_nodes.map((item) => `${item.node_name}（${readableStatus(item.status)}）`).join("、");
}

function nodeHint(node: ApprovalChainNode, nodeNumber: string, blockingNodes: string) {
  if (node.node_status === "rejected") return `退回流向：${nodeNumber} ${nodeTitle(node)} -> 节点1 待提交`;
  if (node.node_status === "cancelled") return "历史路线已作废，不参与当前审批";
  if (node.node_status === "waiting" && blockingNodes) return "前序未完成，暂不进入待办";
  if (node.node_status === "active") return "当前处理节点";
  return "";
}

function MetaRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words", muted ? "text-muted-foreground" : "text-foreground")}>
        {value}
      </dd>
    </div>
  );
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
  const roleLabel = textValue(node.assignee_role || node.resolver_role);

  return (
    <div
      className={cn(
        chainCardClass,
        node.node_status === "active" && "border-primary/70 shadow-sm ring-2 ring-primary/10",
        node.node_status === "rejected" && "border-destructive/50",
        muted && "bg-muted/20 text-muted-foreground",
      )}
    >
      <div className="absolute -left-1 top-3 size-2 rounded-full bg-border" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block break-words text-sm leading-5 text-foreground">
            {nodeNumber}：{nodeTitle(node)}
          </strong>
          <span className="mt-0.5 block break-words leading-5 text-muted-foreground">
            模板节点 {node.node_key}
            {roleLabel ? ` · ${roleLabel}` : ""}
          </span>
        </div>
        <Badge
          variant={statusVariant[node.node_status] || "secondary"}
          className="max-w-20 shrink-0 whitespace-normal text-center text-[10px] leading-4"
        >
          {statusLabel[node.node_status] || node.node_status}
        </Badge>
      </div>
      <ul className="mt-2 space-y-1.5">
        {assignees.map((assignee, index) => {
          const assigneeName = assignee.assignee_name || `员工 ${assignee.assignee_user_id}`;
          const projectCode = textValue(assignee.project_code) || "未关联";
          const projectName = textValue(assignee.project_name) || "未关联";
          const actedAt = formatDateTime(assignee.acted_at);
          const statusText = readableAssigneeStatus(assignee.status);
          const nodeStatusText = readableStatus(assignee.node_status || node.node_status);
          const actionText = readableAction(assignee.action);
          const runtimeNodeName = textValue(assignee.node_name);
          const commentText = textValue(assignee.comment) || "无";
          const key = [
            node.node_id,
            assignee.node_id ?? "template",
            assignee.assignee_user_id,
            assignee.status,
            assignee.action ?? "",
            assignee.acted_at ?? "",
            index,
          ].join("-");

          return (
            <li key={key} className="rounded-sm bg-muted/40 px-2 py-1.5 leading-5">
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium text-foreground">{assigneeName}</span>
                <Badge
                  variant={statusVariant[assignee.node_status || node.node_status] || "secondary"}
                  className="max-w-20 shrink-0 whitespace-normal text-center text-[10px] leading-4"
                >
                  {nodeStatusText}
                </Badge>
              </div>
              <dl className="space-y-1">
                <MetaRow label="项目编码" value={projectCode} muted={projectCode === "未关联"} />
                <MetaRow label="项目名称" value={projectName} muted={projectName === "未关联"} />
                {runtimeNodeName && runtimeNodeName !== node.node_name ? (
                  <MetaRow label="执行节点" value={runtimeNodeName} />
                ) : null}
                <MetaRow label="节点状态" value={nodeStatusText} />
                <MetaRow label="人员状态" value={statusText} />
                <MetaRow label="动作" value={actionText} muted={!textValue(assignee.action)} />
                <MetaRow label="意见" value={commentText} muted={!textValue(assignee.comment)} />
                {actedAt ? (
                  <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2">
                    <dt className="text-muted-foreground">时间</dt>
                    <dd className="min-w-0 break-words text-muted-foreground">
                      <time dateTime={assignee.acted_at || undefined}>{actedAt}</time>
                    </dd>
                  </div>
                ) : null}
              </dl>
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
      className="mb-3 min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-card px-3 py-2.5"
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
      <div className="w-full max-w-full overflow-x-auto overscroll-x-contain pb-1">
        <ol className="flex w-max max-w-none items-stretch">
          <li className="flex items-stretch">
            <div className={chainCardClass}>
              <div className="absolute -left-1 top-3 size-2 rounded-full bg-border" />
              <div className="flex items-start justify-between gap-2">
                <strong className="min-w-0 break-words text-sm leading-5 text-foreground">节点1：待提交</strong>
                <Badge
                  variant={hasRejected ? "destructive" : "secondary"}
                  className="max-w-20 shrink-0 whitespace-normal text-center text-[10px] leading-4"
                >
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
          <div className="w-full max-w-full overflow-x-auto overscroll-x-contain pb-1">
            <ol className="flex w-max max-w-none items-stretch">
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
