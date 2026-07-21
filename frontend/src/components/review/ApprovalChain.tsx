import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatApprovalAuditTime,
  isNonApplicableProjectAssignee,
  isNonApplicableProjectSkip,
} from "@/lib/approvalAudit";
import type { ApprovalChainAssignee, ApprovalChainNode } from "@/types/approval";

interface ApprovalChainProps {
  nodes?: ApprovalChainNode[];
  projectId?: number | null;
}

type Variant = "default" | "secondary" | "success" | "destructive" | "outline";

type StageProjectRow = {
  key: string;
  label: string;
  status: string;
  kind: "项目块" | "汇总" | "范围";
  approverNames: string[];
  nonApplicable: boolean;
  approvedAt: string | null;
};

const statusLabel: Record<string, string> = {
  waiting: "待审核",
  active: "审核中",
  pending: "待审核",
  approved: "已通过",
  rejected: "已退回",
  cancelled: "已取消",
  skipped: "已跳过",
  delegated: "已转交",
  waiting_revision: "待提交",
  needs_revision: "待提交",
  revision_required: "待提交",
  needs_reapproval: "待审核",
};

const statusVariant: Record<string, Variant> = {
  waiting: "outline",
  active: "default",
  pending: "outline",
  approved: "success",
  rejected: "destructive",
  cancelled: "secondary",
  skipped: "secondary",
  delegated: "secondary",
  waiting_revision: "outline",
  needs_revision: "destructive",
  revision_required: "destructive",
  needs_reapproval: "outline",
};

const stageCardClass =
  "relative w-56 max-w-[calc(100vw-3.5rem)] shrink-0 rounded-md border bg-background p-2.5 text-xs sm:w-64";

const openStatuses = new Set(["active", "pending", "waiting", "needs_reapproval"]);

const statusPriority: Record<string, number> = {
  rejected: 90,
  needs_revision: 85,
  revision_required: 85,
  active: 80,
  pending: 75,
  waiting: 70,
  needs_reapproval: 65,
  approved: 50,
  skipped: 45,
  cancelled: 40,
  delegated: 35,
};

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
  const hasNodeLevelRecord = Boolean(
    node.result_action ||
      node.comment ||
      ["approved", "rejected", "cancelled", "skipped", "needs_revision", "revision_required"].includes(
        String(node.node_status || ""),
      ),
  );
  if (!hasNodeLevelRecord) return [];
  return [
    {
      node_id: node.node_id,
      node_name: node.node_name,
      node_status: node.node_status,
      project_id: node.scope_type === "project" ? node.scope_id || null : null,
      project_code: node.project_code || "",
      project_name: node.project_name || "",
      assignee_user_id: 0,
      assignee_name: "系统/自动处理",
      status: node.node_status,
      action: node.result_action,
      comment: node.comment || null,
      acted_at: node.completed_at || node.activated_at || null,
    },
  ];
}

function assigneeKey(assignee: ApprovalChainAssignee) {
  const name = textValue(assignee.assignee_name);
  return name || (assignee.assignee_user_id ? `员工 ${assignee.assignee_user_id}` : "");
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

function nodeDisplayStatus(node: ApprovalChainNode) {
  return textValue(node.node_status) || "waiting";
}

function assigneeProjectLabel(assignee: ApprovalChainAssignee) {
  const projectId = textValue(assignee.project_id);
  const code = textValue(assignee.project_code);
  const name = textValue(assignee.project_name);
  return [code, name].filter(Boolean).join(" ") || (projectId ? `项目 #${projectId}` : "");
}

function assigneeDisplayStatus(assignee: ApprovalChainAssignee, node: ApprovalChainNode) {
  if (isNonApplicableProjectAssignee(assignee)) return "skipped";
  const nodeStatus = textValue(assignee.node_status || node.node_status);
  const assigneeStatus = textValue(assignee.status);
  if (openStatuses.has(nodeStatus) && ["cancelled", "delegated"].includes(assigneeStatus)) return nodeStatus;
  if (nodeStatus && nodeStatus !== "active") return nodeStatus;
  return assigneeStatus || nodeStatus || "waiting";
}

function isEffectiveStageAssignee(assignee: ApprovalChainAssignee, node: ApprovalChainNode) {
  if (isNonApplicableProjectAssignee(assignee)) return false;
  const nodeStatus = textValue(assignee.node_status || node.node_status);
  const assigneeStatus = textValue(assignee.status) || nodeStatus;
  const action = textValue(assignee.action);

  if (openStatuses.has(nodeStatus)) {
    return openStatuses.has(assigneeStatus) && !action && !assignee.acted_at;
  }
  if (nodeStatus === "approved") return assigneeStatus === "approved" || ["approve", "approved"].includes(action);
  if (nodeStatus === "rejected") return assigneeStatus === "rejected" || ["reject", "rejected"].includes(action);
  return !["cancelled", "delegated", "skipped"].includes(assigneeStatus);
}

function assigneeApprovedAt(assignee: ApprovalChainAssignee) {
  const status = textValue(assignee.status);
  const action = textValue(assignee.action);
  if (status !== "approved" && !["approve", "approved"].includes(action)) return null;
  return textValue(assignee.acted_at) || null;
}

function chooseStageStatus(current: string, next: string) {
  return (statusPriority[next] || 0) > (statusPriority[current] || 0) ? next : current;
}

function projectScopedNodes(nodes: ApprovalChainNode[], projectId?: number | null) {
  if (!projectId) return nodes;

  const projected = nodes.flatMap((node) => {
    const assignees = fallbackAssignees(node).filter(
      (assignee) =>
        Number(assignee.project_id) === Number(projectId) &&
        !isNonApplicableProjectAssignee(assignee),
    );
    if (!assignees.length) return [];

    const project = assignees[0];
    const nodeStatus = assignees
      .map((assignee) => textValue(assignee.node_status) || textValue(assignee.status) || "waiting")
      .reduce(chooseStageStatus);

    return [{
      ...node,
      scope_type: "project",
      scope_id: Number(projectId),
      project_code: project.project_code || node.project_code || "",
      project_name: project.project_name || node.project_name || "",
      node_status: nodeStatus,
      assignees,
      blocking_nodes: [],
    }];
  });

  return projected;
}

function stageProjectRows(node: ApprovalChainNode): StageProjectRow[] {
  const rows = new Map<string, StageProjectRow>();
  for (const assignee of fallbackAssignees(node)) {
    const label = assigneeProjectLabel(assignee);
    if (!label || label === "未关联") continue;
    const key = textValue(assignee.project_id) || label;
    const status = assigneeDisplayStatus(assignee, node);
    const existing = rows.get(key);
    const approverName = assigneeKey(assignee);
    const approverNames = new Set(existing?.approverNames || []);
    if (
      approverName &&
      approverName !== "系统/自动处理" &&
      isEffectiveStageAssignee(assignee, node)
    ) {
      approverNames.add(approverName);
    }
    const approvedAt = assigneeApprovedAt(assignee);
    rows.set(key, {
      key,
      label,
      status: existing ? chooseStageStatus(existing.status, status) : status,
      kind: "项目块",
      approverNames: Array.from(approverNames),
      nonApplicable: Boolean(existing?.nonApplicable || isNonApplicableProjectAssignee(assignee)),
      approvedAt: [existing?.approvedAt, approvedAt].filter(Boolean).sort().at(-1) || null,
    });
  }
  if (rows.size) return Array.from(rows.values());

  const displayStatus = nodeDisplayStatus(node);
  if (isDepartmentSummaryNode(node)) {
    return [{
      key: `summary-${node.node_id}`,
      label: "汇总确认",
      status: displayStatus,
      kind: "汇总",
      approverNames: [],
      nonApplicable: isNonApplicableProjectSkip(node.comment),
      approvedAt: displayStatus === "approved" ? textValue(node.completed_at) || null : null,
    }];
  }
  return [{
    key: `scope-${node.node_id}`,
    label: projectLabelFromNode(node),
    status: displayStatus,
    kind: node.scope_type === "project" ? "项目块" : "范围",
    approverNames: [],
    nonApplicable: isNonApplicableProjectSkip(node.comment),
    approvedAt: displayStatus === "approved" ? textValue(node.completed_at) || null : null,
  }];
}

function stageApproverLabel(row: StageProjectRow) {
  if (row.approverNames.length) return row.approverNames.join("、");
  return row.nonApplicable ? "无需审批" : "未配置";
}

function blockingLabel(node: ApprovalChainNode) {
  return node.blocking_nodes.map((item) => `${item.node_name}（${readableStatus(item.status)}）`).join("、");
}

function nodeHint(node: ApprovalChainNode, nodeNumber: string, blockingNodes: string) {
  if (node.node_status === "rejected") return "已退回到提交人";
  if (node.node_status === "cancelled") return `${nodeNumber} 已取消，不参与当前审批`;
  if (node.node_status === "waiting" && blockingNodes) return `等待前序完成：${blockingNodes}`;
  if (node.node_status === "active") return "";
  if (node.node_status === "skipped") return "该阶段已跳过";
  return "";
}

function projectLabelFromNode(node: ApprovalChainNode) {
  const code = textValue(node.project_code);
  const name = textValue(node.project_name);
  if (code || name) return [code, name].filter(Boolean).join(" ");
  if (node.scope_type === "project" && node.scope_id) return `项目 #${node.scope_id}`;
  if (isDepartmentSummaryNode(node)) return "汇总确认";
  return "周表";
}

function Connector({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="flex w-8 items-center" aria-hidden="true">
      <div className="h-px w-full bg-border" />
    </div>
  );
}

function StageCard({ node, nodeNumber }: { node: ApprovalChainNode; nodeNumber: string }) {
  const blockingNodes = blockingLabel(node);
  const hint = nodeHint(node, nodeNumber, blockingNodes);
  const displayStatus = nodeDisplayStatus(node);
  const projectRows = stageProjectRows(node);

  return (
    <div
      aria-current={node.node_status === "active" ? "step" : undefined}
      className={cn(
        stageCardClass,
        node.node_status === "active" && "border-brand-accent shadow-sm ring-2 ring-brand-accent/20",
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
          variant={statusVariant[displayStatus] || "secondary"}
          className="max-w-20 shrink-0 whitespace-normal text-center text-[10px] leading-4"
        >
          {readableStatus(displayStatus)}
        </Badge>
      </div>
      <div className="mt-2 space-y-1.5 leading-5">
        <div className="space-y-1">
          {projectRows.map((row) => (
            <div
              key={row.key}
              aria-label={`${row.label}审批状态`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-sm border border-border/70 bg-muted/20 px-2 py-1.5"
            >
              <div className="min-w-0">
                <div className="text-[11px] text-muted-foreground">{row.kind}</div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <div className="min-w-0 break-words text-foreground">{row.label}</div>
                  {row.approvedAt ? (
                    <time
                      dateTime={row.approvedAt}
                      className="ml-auto shrink-0 tabular-nums text-[10px] text-muted-foreground"
                    >
                      {formatApprovalAuditTime(row.approvedAt)}
                    </time>
                  ) : null}
                </div>
              </div>
              <div className="flex max-w-32 flex-wrap items-center justify-end gap-1">
                <span className="break-words text-right text-[11px] text-foreground">
                  {stageApproverLabel(row)}
                </span>
                <Badge
                  variant={statusVariant[row.status] || "secondary"}
                  className="justify-center whitespace-normal text-center text-[10px] leading-4"
                >
                  {readableStatus(row.status)}
                </Badge>
              </div>
            </div>
          ))}
        </div>
        {hint ? (
          <p className="rounded-sm bg-muted/40 px-2 py-1 text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}

export function ApprovalChain({ nodes = [], projectId }: ApprovalChainProps) {
  const displayNodes = projectScopedNodes(nodes, projectId);
  if (!displayNodes.length) return null;

  return (
    <section
      aria-label="审批链路"
      className="mb-3 min-w-0 max-w-full overflow-hidden rounded-md border border-border bg-card px-3 py-2.5"
      style={{ contain: "inline-size" }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="text-xs text-foreground">审批链路</strong>
        <span className="text-[11px] text-muted-foreground">
          {projectId ? "当前项目块的实际审批节点" : "流程阶段、项目块审批人与状态"}
        </span>
      </div>
      <div className="block w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-1">
        <ol className="inline-flex min-w-max max-w-none items-stretch">
          {displayNodes.map((node, index) => (
            <li className="flex items-stretch" key={`${node.node_key}-${node.scope_id || node.node_id}`}>
              <StageCard node={node} nodeNumber={`阶段${index + 1}`} />
              <Connector show={index < displayNodes.length - 1} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
