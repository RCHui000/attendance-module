import { expect, test } from "@playwright/test";
import {
  deriveApprovalDisplayStatus,
  formatApprovalAuditTime,
  getAssigneeAuditSummary,
} from "../src/components/review/approvalAudit";
import type { ApprovalChainAssignee, ApprovalChainNode } from "../src/types/approval";

function node(status: string): ApprovalChainNode {
  return {
    node_id: 1,
    node_key: `node-${status}`,
    node_name: "Timesheet review",
    node_status: status,
    sort_order: 10,
    can_current_user_act: false,
    assignees: [],
    blocking_nodes: [],
  };
}

test.describe("review approval audit helpers", () => {
  test("shows revision required when an approved sheet has a rejected graph node", () => {
    expect(deriveApprovalDisplayStatus("approved", [node("approved"), node("rejected")])).toBe(
      "revision_required",
    );
  });

  test("keeps approved when approved sheet graph is fully terminal", () => {
    expect(deriveApprovalDisplayStatus("approved", [node("approved"), node("skipped")])).toBe(
      "approved",
    );
  });

  test("keeps submitted when submitted sheet has an active graph node", () => {
    expect(deriveApprovalDisplayStatus("submitted", [node("active")])).toBe("submitted");
  });

  test("formats assignee action, audit time, and comment without inventing missing time", () => {
    const approvedAssignee: ApprovalChainAssignee = {
      assignee_user_id: 12,
      assignee_name: "审批人A",
      status: "approved",
      action: "approve",
      comment: "同意",
      acted_at: "2026-05-17T06:32:00.000Z",
    };
    const pendingAssignee: ApprovalChainAssignee = {
      assignee_user_id: 13,
      assignee_name: "审批人B",
      status: "pending",
      action: null,
      comment: null,
      acted_at: null,
    };

    expect(formatApprovalAuditTime(approvedAssignee.acted_at)).toBe("05-17 14:32");
    expect(getAssigneeAuditSummary(approvedAssignee)).toEqual({
      actionLabel: "已通过",
      timeLabel: "05-17 14:32",
      commentLabel: "同意",
      statusLabel: "已通过",
    });
    expect(getAssigneeAuditSummary(pendingAssignee)).toEqual({
      actionLabel: "待审核",
      timeLabel: "",
      commentLabel: "",
      statusLabel: "待审核",
    });
  });
});
