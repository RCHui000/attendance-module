import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getAssigneeAuditSummary } from "@/lib/approvalAudit";
import type { ApprovalChainAssignee, ApprovalChainNode } from "@/types/approval";

interface ApprovalChainProps {
  nodes?: ApprovalChainNode[];
}

const statusLabel: Record<string, string> = {
  waiting: "待审核",
  active: "审核中",
  pending: "待审核",
  approved: "已通过",
  rejected: "已退回",
  cancelled: "已回退",
  skipped: "已跳过",
  waiting_revision: "待提交",
  needs_revision: "待提交",
  needs_reapproval: "待审核",
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

const chainCardClass =
  "relative w-56 max-w-[calc(100vw-3.5rem)] shrink-0 rounded-md border bg-background p-2.5 text-xs sm:w-64";

function textValue(value?: number | string | null) {
  return String(value ?? "").trim();
}

function readableStatus(value?: string | null) {
  const raw = textValue(value);
  if (!raw) return "待审核";
  return statusLabel[raw] || raw;
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
      assignee_name: "",
      status: node.node_status === "active" ? "pending" : node.node_status,
      action: null,
      comment: null,
      acted_at: null,
    },
  ];
}

function assigneeKey(assignee: ApprovalChainAssignee) {
  const name = textValue(assignee.assignee_name);
  return name || (assignee.assignee_user_id ? `员工 ${assignee.assignee_user_id}` : "");
}

function uniqueAssigneeNames(node: ApprovalChainNode) {
  const names = new Map<string, string>();
  fallbackAssignees(node).forEach((assignee) => {
    const name = assigneeKey(assignee);
    if (!name || name === "员工 0") return;
    names.set(name, name);
  });
  return Array.from(names.values());
}

function projectRows(node: ApprovalChainNode) {
  const projects = new Map<string, ApprovalChainAssignee>();
  fallbackAssignees(node).forEach((assignee) => {
    const projectId = assignee.project_id ? String(assignee.project_id) : "";
    const code = textValue(assignee.project_code);
    const name = textValue(assignee.project_name);
    if (!projectId && !code && !name) return;
    if (!projectId && code === "未关联" && name === "未关联") return;
    const label = [code, name].filter(Boolean).join(" ");
    if (!projects.has(projectId || label)) projects.set(projectId || label, assignee);
  });
  return Array.from(projects.values());
}

function isDepartmentSummaryNode(node: ApprovalChainNode) {
  return node.scope_type === "department_summary";
}

function displayNodeName(node: ApprovalChainNode) {
  if (isDepartmentSummaryNode(node) && !node.node_name.includes("汇总")) {
    return `${node.node_name} 汇总确认`;
  }
  return node.node_name;
}

function projectLabel(assignee: ApprovalChainAssignee) {
  const projectId = assignee.project_id ? String(assignee.project_id) : "";
  const code = textValue(assignee.project_code);
  const name = textValue(assignee.project_name);
  return [code, name].filter(Boolean).join(" ") || `项目 ${projectId}`;
}

function projectDisplayStatus(assignee: ApprovalChainAssignee, node: ApprovalChainNode) {
  const nodeStatus = textValue(assignee.node_status || node.node_status);
  const assigneeStatus = textValue(assignee.status);
  if (nodeStatus && nodeStatus !== "active") return nodeStatus;
  return assigneeStatus || nodeStatus || "waiting";
}

function blockingLabel(node: ApprovalChainNode) {
  return node.blocking_nodes.map((item) => `${item.node_name}（${readableStatus(item.status)}）`).join("、");
}

function nodeHint(node: ApprovalChainNode, nodeNumber: string, blockingNodes: string) {
  if (node.node_status === "rejected") return `已退回到节点1：待提交`;
  if (node.node_status === "cancelled") return `${nodeNumber} 已回退，不参与当前待办`;
  if (node.node_status === "waiting" && blockingNodes) return "前序未完成，暂不进入待办";
  if (node.node_status === "active") return "当前审批步骤";
  return "";
}

function Connector({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="flex w-8 items-center" aria-hidden="true">
      <div className="h-px w-full bg-border" />
    </div>
  );
}

function ChainCard({ node, nodeNumber }: { node: ApprovalChainNode; nodeNumber: string }) {
  const assigneeNames = uniqueAssigneeNames(node);
  const blockingNodes = blockingLabel(node);
  const hint = nodeHint(node, nodeNumber, blockingNodes);
  const projects = projectRows(node);
  const showSummaryRow = isDepartmentSummaryNode(node) && projects.length === 0;
  const auditAssignees = fallbackAssignees(node).filter((assignee) => {
    const name = assigneeKey(assignee);
    return Boolean(name && name !== "员工 0");
  });

  return (
    <div
      className={cn(
        chainCardClass,
        node.node_status === "active" && "border-primary/70 shadow-sm ring-2 ring-primary/10",
        node.node_status === "rejected" && "border-destructive/50",
        node.node_status === "cancelled" && "bg-muted/20 text-muted-foreground",
      )}
    >
      <div className="absolute -left-1 top-3 size-2 rounded-full bg-border" />
      <div className="flex items-start justify-between gap-2">
        <strong className="min-w-0 break-words text-sm leading-5 text-foreground">
          {nodeNumber}：{displayNodeName(node)}
        </strong>
        <Badge
          variant={statusVariant[node.node_status] || "secondary"}
          className="max-w-20 shrink-0 whitespace-normal text-center text-[10px] leading-4"
        >
          {readableStatus(node.node_status)}
        </Badge>
      </div>

      <div className="mt-2 space-y-1.5 leading-5">
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2">
          <span className="text-muted-foreground">审批人</span>
          <span className={cn("min-w-0 break-words", assigneeNames.length ? "text-foreground" : "text-muted-foreground")}>
            {assigneeNames.length ? assigneeNames.join("、") : "未配置"}
          </span>
        </div>
        {projects.length || showSummaryRow ? (
          <div className="space-y-1">
            <div className="text-muted-foreground">{showSummaryRow ? "汇总" : "项目块"}</div>
            <div className="space-y-1">
              {showSummaryRow ? (
                <div className="grid grid-cols-[minmax(0,1fr)_3.75rem] items-start gap-2 rounded-sm border border-border/70 bg-muted/20 px-2 py-1.5">
                  <span className="min-w-0 break-words leading-5 text-foreground">部门汇总确认（全部项目块）</span>
                  <Badge
                    variant={statusVariant[node.node_status] || "secondary"}
                    className="justify-center whitespace-normal text-center text-[10px] leading-4"
                  >
                    {readableStatus(node.node_status)}
                  </Badge>
                </div>
              ) : null}
              {projects.map((project) => {
                const rowStatus = projectDisplayStatus(project, node);
                return (
                  <div
                    key={`${project.project_id || projectLabel(project)}-${rowStatus}`}
                    className="grid grid-cols-[minmax(0,1fr)_3.75rem] items-start gap-2 rounded-sm border border-border/70 bg-muted/20 px-2 py-1.5"
                  >
                    <span className="min-w-0 break-words leading-5 text-foreground">{projectLabel(project)}</span>
                    <Badge
                      variant={statusVariant[rowStatus] || "secondary"}
                      className="justify-center whitespace-normal text-center text-[10px] leading-4"
                    >
                      {readableStatus(rowStatus)}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {auditAssignees.length ? (
          <div className="space-y-1">
            <div className="text-muted-foreground">审批记录</div>
            <div className="space-y-1">
              {auditAssignees.map((assignee) => {
                const name = assigneeKey(assignee);
                const summary = getAssigneeAuditSummary(assignee);
                return (
                  <div
                    key={`${name}-${assignee.action || assignee.status || "pending"}-${assignee.acted_at || "no-time"}`}
                    className="rounded-sm border border-border/70 bg-muted/20 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words text-foreground">{name}</span>
                      <Badge
                        variant={statusVariant[assignee.status] || "secondary"}
                        className="whitespace-normal text-center text-[10px] leading-4"
                      >
                        {summary.actionLabel}
                      </Badge>
                      {summary.timeLabel ? (
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {summary.timeLabel}
                        </span>
                      ) : null}
                    </div>
                    {summary.commentLabel ? (
                      <p className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">
                        {summary.commentLabel}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        {hint ? (
          <p className="rounded-sm bg-muted/40 px-2 py-1 text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

export function ApprovalChain({ nodes = [] }: ApprovalChainProps) {
  if (!nodes.length) return null;

  const hasRejected = nodes.some((node) => node.node_status === "rejected");
  const hasActive = nodes.some((node) => node.node_status === "active");
  const submitStatus = hasRejected ? "待提交" : "已提交";
  const submitHint = hasRejected
    ? "有节点退回，流程回到提交人。重新提交后继续按模板流转。"
    : hasActive
      ? "已提交，正在按审批模板流转。"
      : "已提交，等待审批模板节点处理。";

  return (
    <section
      aria-label="审批链路"
      className="mb-3 min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-card px-3 py-2.5"
      style={{ contain: "inline-size" }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="text-xs text-foreground">审批链路</strong>
        <span className="text-[11px] text-muted-foreground">
          按当前周表绑定模板显示，共 {nodes.length + 1} 个节点（含提交节点）
        </span>
      </div>
      <div className="block w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-1">
        <ol className="inline-flex min-w-max max-w-none items-stretch">
          <li className="flex items-stretch">
            <div className={cn(chainCardClass, hasRejected && "border-destructive/50")}>
              <div className="absolute -left-1 top-3 size-2 rounded-full bg-border" />
              <div className="flex items-start justify-between gap-2">
                <strong className="min-w-0 break-words text-sm leading-5 text-foreground">节点1：待提交</strong>
                <Badge
                  variant={hasRejected ? "destructive" : "secondary"}
                  className="max-w-20 shrink-0 whitespace-normal text-center text-[10px] leading-4"
                >
                  {submitStatus}
                </Badge>
              </div>
              <p className="mt-2 rounded-sm bg-muted/40 px-2 py-1.5 text-xs leading-5 text-muted-foreground">
                {submitHint}
              </p>
            </div>
            <Connector show={nodes.length > 0} />
          </li>
          {nodes.map((node, index) => (
            <li className="flex items-stretch" key={`${node.node_key}-${node.scope_id || node.node_id}`}>
              <ChainCard node={node} nodeNumber={`节点${index + 2}`} />
              <Connector show={index < nodes.length - 1} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
