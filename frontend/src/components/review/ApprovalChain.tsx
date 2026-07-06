import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getAssigneeAuditSummary, isNonApplicableProjectSkip } from "@/lib/approvalAudit";
import type { ApprovalChainAssignee, ApprovalChainNode } from "@/types/approval";

interface ApprovalChainProps {
  nodes?: ApprovalChainNode[];
}

interface ApprovalRecordsProps {
  nodes?: ApprovalChainNode[];
  projectId?: number | null;
}

type Variant = "default" | "secondary" | "success" | "destructive" | "outline";

type StageProjectRow = {
  key: string;
  label: string;
  status: string;
  kind: "项目块" | "汇总" | "范围";
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

const historicalStatuses = new Set([
  "approved",
  "rejected",
  "skipped",
  "cancelled",
  "delegated",
  "needs_revision",
  "revision_required",
]);

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

function hasHistoricalAssigneeRecord(assignee: ApprovalChainAssignee) {
  const status = textValue(assignee.status);
  return Boolean(
    assignee.action ||
      assignee.acted_at ||
      assignee.comment ||
      isNonApplicableProjectSkip(assignee.comment) ||
      historicalStatuses.has(status),
  );
}

function recordAssignees(node: ApprovalChainNode) {
  return fallbackAssignees(node).filter(hasHistoricalAssigneeRecord);
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
  if (isNonApplicableProjectSkip(node.comment)) return "approved";
  return textValue(node.node_status) || "waiting";
}

function assigneeProjectLabel(assignee: ApprovalChainAssignee) {
  const projectId = textValue(assignee.project_id);
  const code = textValue(assignee.project_code);
  const name = textValue(assignee.project_name);
  return [code, name].filter(Boolean).join(" ") || (projectId ? `项目 #${projectId}` : "");
}

function assigneeDisplayStatus(assignee: ApprovalChainAssignee, node: ApprovalChainNode) {
  if (isNonApplicableProjectSkip(assignee.comment) || isNonApplicableProjectSkip(node.comment)) return "approved";
  const nodeStatus = textValue(assignee.node_status || node.node_status);
  const assigneeStatus = textValue(assignee.status);
  if (nodeStatus && nodeStatus !== "active") return nodeStatus;
  return assigneeStatus || nodeStatus || "waiting";
}

function chooseStageStatus(current: string, next: string) {
  return (statusPriority[next] || 0) > (statusPriority[current] || 0) ? next : current;
}

function stageProjectRows(node: ApprovalChainNode): StageProjectRow[] {
  const rows = new Map<string, StageProjectRow>();
  for (const assignee of fallbackAssignees(node)) {
    const label = assigneeProjectLabel(assignee);
    if (!label || label === "未关联") continue;
    const key = textValue(assignee.project_id) || label;
    const status = assigneeDisplayStatus(assignee, node);
    const existing = rows.get(key);
    rows.set(key, {
      key,
      label,
      status: existing ? chooseStageStatus(existing.status, status) : status,
      kind: "项目块",
    });
  }
  if (rows.size) return Array.from(rows.values());

  const displayStatus = nodeDisplayStatus(node);
  if (isDepartmentSummaryNode(node)) {
    return [{ key: `summary-${node.node_id}`, label: "汇总确认", status: displayStatus, kind: "汇总" }];
  }
  return [{
    key: `scope-${node.node_id}`,
    label: projectLabelFromNode(node),
    status: displayStatus,
    kind: node.scope_type === "project" ? "项目块" : "范围",
  }];
}

function blockingLabel(node: ApprovalChainNode) {
  return node.blocking_nodes.map((item) => `${item.node_name}（${readableStatus(item.status)}）`).join("、");
}

function nodeHint(node: ApprovalChainNode, nodeNumber: string, blockingNodes: string) {
  if (node.node_status === "rejected") return "已退回到提交人";
  if (node.node_status === "cancelled") return `${nodeNumber} 已取消，不参与当前审批`;
  if (node.node_status === "waiting" && blockingNodes) return `等待前序完成：${blockingNodes}`;
  if (node.node_status === "active") return "当前审批阶段";
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

function recordProjectId(node: ApprovalChainNode, assignee?: ApprovalChainAssignee) {
  return assignee?.project_id || (node.scope_type === "project" ? node.scope_id : null) || null;
}

function recordProjectLabel(node: ApprovalChainNode, assignee?: ApprovalChainAssignee) {
  const code = textValue(assignee?.project_code) || textValue(node.project_code);
  const name = textValue(assignee?.project_name) || textValue(node.project_name);
  if (code || name) return [code, name].filter(Boolean).join(" ");
  if (isDepartmentSummaryNode(node)) return "汇总确认";
  const projectId = recordProjectId(node, assignee);
  return projectId ? `项目 #${projectId}` : "周表";
}

function recordKey(node: ApprovalChainNode, assignee: ApprovalChainAssignee, index: number) {
  return [
    node.node_id,
    assignee.assignee_user_id || "system",
    assignee.status || "status",
    assignee.action || "action",
    assignee.acted_at || "no-time",
    index,
  ].join(":");
}

function recordSource(node: ApprovalChainNode, assignee: ApprovalChainAssignee) {
  return textValue(assignee.assignee_route_source) || textValue(node.assignee_role) || textValue(node.resolver_role);
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
      className={cn(
        stageCardClass,
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
              className="grid grid-cols-[minmax(0,1fr)_3.75rem] items-start gap-2 rounded-sm border border-border/70 bg-muted/20 px-2 py-1.5"
            >
              <div className="min-w-0">
                <div className="text-[11px] text-muted-foreground">{row.kind}</div>
                <div className="mt-0.5 break-words text-foreground">{row.label}</div>
              </div>
              <Badge
                variant={statusVariant[row.status] || "secondary"}
                className="justify-center whitespace-normal text-center text-[10px] leading-4"
              >
                {readableStatus(row.status)}
              </Badge>
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

export function ApprovalChain({ nodes = [] }: ApprovalChainProps) {
  if (!nodes.length) return null;

  const hasRejected = nodes.some((node) => node.node_status === "rejected");
  const hasActive = nodes.some((node) => node.node_status === "active");
  const submitStatus = hasRejected ? "待提交" : "已提交";
  const submitHint = hasRejected
    ? "有项目块退回，流程回到提交人。"
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
          仅显示流程阶段和项目块状态，审批记录见下方项目块卡片
        </span>
      </div>
      <div className="block w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain pb-1">
        <ol className="inline-flex min-w-max max-w-none items-stretch">
          <li className="flex items-stretch">
            <div className={cn(stageCardClass, hasRejected && "border-destructive/50")}>
              <div className="absolute -left-1 top-3 size-2 rounded-full bg-border" />
              <div className="flex items-start justify-between gap-2">
                <strong className="min-w-0 break-words text-sm leading-5 text-foreground">提交</strong>
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
              <StageCard node={node} nodeNumber={`阶段${index + 1}`} />
              <Connector show={index < nodes.length - 1} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function ApprovalRecords({ nodes = [], projectId }: ApprovalRecordsProps) {
  const records = nodes
    .flatMap((node) =>
      recordAssignees(node).map((assignee, index) => {
        const summary = getAssigneeAuditSummary(assignee);
        const resolvedProjectId = recordProjectId(node, assignee);
        const status = assignee.status || node.node_status;
        return {
          key: recordKey(node, assignee, index),
          projectId: resolvedProjectId,
          projectLabel: recordProjectLabel(node, assignee),
          nodeName: displayNodeName(node),
          source: recordSource(node, assignee),
          actor: assigneeKey(assignee),
          status,
          statusLabel: readableStatus(status),
          actionLabel: summary.actionLabel,
          timeLabel: summary.timeLabel,
          commentLabel: summary.commentLabel,
          orderTime: assignee.acted_at ? Date.parse(assignee.acted_at) || 0 : 0,
        };
      }),
    )
    .filter((record) => record.actor)
    .filter((record) => projectId == null || Number(record.projectId) === Number(projectId))
    .sort((a, b) => a.orderTime - b.orderTime || a.nodeName.localeCompare(b.nodeName));

  if (!records.length) {
    return (
      <section className="rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        暂无审批记录
      </section>
    );
  }

  const groups = new Map<string, typeof records>();
  for (const record of records) {
    const key = `${record.projectId || "summary"}:${record.projectLabel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(record);
  }

  return (
    <section aria-label="审批记录" className="space-y-2">
      <div className="flex items-center gap-2">
        <strong className="text-xs text-foreground">审批记录</strong>
        <span className="text-[11px] text-muted-foreground">按项目块归集完整处理记录</span>
      </div>
      {[...groups.entries()].map(([key, items]) => (
        <div key={key} className="rounded-md border border-border bg-card p-3">
          <div className="mb-2 text-sm font-semibold text-foreground">{items[0]?.projectLabel || "周表"}</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <article key={item.key} className="rounded-md border border-border/70 bg-muted/20 p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant[item.status] || "secondary"} className="text-[10px] leading-4">
                    {item.actionLabel}
                  </Badge>
                  {item.timeLabel ? (
                    <span className="tabular-nums text-muted-foreground">{item.timeLabel}</span>
                  ) : null}
                </div>
                <div className="mt-2 space-y-1 leading-5">
                  <div className="break-words text-foreground">{item.nodeName}</div>
                  <div className="break-words text-muted-foreground">
                    {item.actor}
                  </div>
                  <div className="break-words text-muted-foreground">状态：{item.statusLabel}</div>
                  {item.source ? (
                    <div className="break-words text-muted-foreground">来源：{item.source}</div>
                  ) : null}
                  {item.commentLabel ? (
                    <p className="break-words rounded-sm bg-background/70 px-2 py-1 text-muted-foreground">
                      {item.commentLabel}
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
