import type { ApprovalChainAssignee } from "@/types/approval";

type ApprovalNodeLike = {
  node_status?: string | null;
};

const FINAL_SHEET_STATUSES = new Set(["approved", "locked", "summarized"]);
const SHEET_STATUS_PRIORITY = new Set(["draft", "rejected", "revision_required"]);
const WAITING_GRAPH_STATUSES = new Set(["active", "waiting", "pending"]);
const TERMINAL_GRAPH_STATUSES = new Set(["approved", "skipped", "cancelled"]);

const actionLabels: Record<string, string> = {
  approve: "已通过",
  approved: "已通过",
  reject: "已退回",
  rejected: "已退回",
  delegate: "已转交",
  delegated: "已转交",
  skip: "已跳过",
  skipped: "已跳过",
  cancel: "已取消",
  cancelled: "已取消",
  submit: "已提交",
  withdraw: "已撤回",
  reopen: "已重新打开",
  pending: "待审核",
};

const statusLabels: Record<string, string> = {
  waiting: "待审核",
  active: "审核中",
  pending: "待审核",
  approved: "已通过",
  rejected: "已退回",
  cancelled: "已取消",
  skipped: "已跳过",
  needs_reapproval: "待重新审批",
  revision_required: "待重新提交",
};

export function deriveApprovalDisplayStatus(
  sheetStatus: string,
  nodes: ApprovalNodeLike[] = [],
) {
  const normalizedSheetStatus = String(sheetStatus || "");
  if (SHEET_STATUS_PRIORITY.has(normalizedSheetStatus)) return normalizedSheetStatus;

  const statuses = nodes.map((node) => String(node.node_status || "")).filter(Boolean);
  if (statuses.includes("rejected")) return "revision_required";
  if (statuses.includes("needs_reapproval")) return "needs_reapproval";
  if (
    !FINAL_SHEET_STATUSES.has(normalizedSheetStatus) &&
    statuses.some((status) => WAITING_GRAPH_STATUSES.has(status))
  ) {
    return "submitted";
  }
  if (
    FINAL_SHEET_STATUSES.has(normalizedSheetStatus) &&
    statuses.length > 0 &&
    statuses.every((status) => TERMINAL_GRAPH_STATUSES.has(status))
  ) {
    return normalizedSheetStatus;
  }
  return normalizedSheetStatus;
}

export function formatApprovalAuditTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(/\//g, "-");
}

export function getAssigneeAuditSummary(assignee: ApprovalChainAssignee) {
  const rawAction = String(assignee.action || assignee.status || "").trim();
  const rawStatus = String(assignee.status || "").trim();
  return {
    actionLabel: actionLabels[rawAction] || statusLabels[rawStatus] || rawAction || "待审核",
    timeLabel: formatApprovalAuditTime(assignee.acted_at),
    commentLabel: String(assignee.comment || "").trim(),
    statusLabel: statusLabels[rawStatus] || actionLabels[rawAction] || rawStatus || "待审核",
  };
}
