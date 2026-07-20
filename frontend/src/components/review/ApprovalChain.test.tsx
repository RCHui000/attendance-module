import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalChain, ApprovalRecords } from "./ApprovalChain";
import type { ApprovalChainNode } from "@/types/approval";
import { formatApprovalAuditTime } from "@/lib/approvalAudit";

afterEach(() => {
  cleanup();
});

function baseNode(overrides: Partial<ApprovalChainNode>): ApprovalChainNode {
  return {
    node_id: 1,
    node_key: "project_lead",
    node_name: "项目负责人",
    scope_type: "project",
    scope_id: 101,
    node_status: "active",
    assignee_role: "lead",
    resolver_role: "lead",
    sort_order: 1,
    can_current_user_act: false,
    assignees: [],
    blocking_nodes: [],
    ...overrides,
  };
}

describe("ApprovalChain", () => {
  it("shows only the selected project's applicable route and omits the submit card", () => {
    const nodes = [
      baseNode({
        node_id: 1,
        node_key: "cc_project_owner",
        node_name: "发起部门项目负责人",
        node_status: "active",
        assignees: [
          {
            node_id: 1,
            node_status: "approved",
            project_id: 101,
            project_code: "CC26001",
            project_name: "咨询项目",
            assignee_user_id: 10,
            assignee_name: "王岳峰",
            status: "approved",
            action: "approve",
          },
          {
            node_id: 2,
            node_status: "active",
            project_id: 102,
            project_code: "PMCC26002",
            project_name: "协作项目",
            assignee_user_id: 20,
            assignee_name: "闫磊",
            status: "pending",
          },
        ],
      }),
      baseNode({
        node_id: 3,
        node_key: "cc_department_owner",
        node_name: "发起部门负责人",
        node_status: "waiting",
        assignees: [
          {
            node_id: 3,
            node_status: "waiting",
            project_id: 101,
            project_code: "CC26001",
            project_name: "咨询项目",
            assignee_user_id: 11,
            assignee_name: "常雪松",
            status: "waiting",
          },
          {
            node_id: 4,
            node_status: "waiting",
            project_id: 102,
            project_code: "PMCC26002",
            project_name: "协作项目",
            assignee_user_id: 21,
            assignee_name: "鞠松松",
            status: "waiting",
          },
        ],
      }),
      baseNode({
        node_id: 5,
        node_key: "pm_cost_design_owner",
        node_name: "PM成本/设计负责人",
        node_status: "waiting",
        assignees: [
          {
            node_id: 5,
            node_status: "skipped",
            project_id: 101,
            project_code: "CC26001",
            project_name: "咨询项目",
            assignee_user_id: 0,
            assignee_name: null,
            status: "skipped",
            action: "skipped",
            comment: "Not applicable for project business type",
          },
          {
            node_id: 6,
            node_status: "waiting",
            project_id: 102,
            project_code: "PMCC26002",
            project_name: "协作项目",
            assignee_user_id: 22,
            assignee_name: "李达",
            status: "waiting",
          },
        ],
      }),
    ];

    render(<ApprovalChain nodes={nodes} projectId={101} />);

    const firstStageTitle = screen.getByText("阶段1：发起部门项目负责人");
    expect(firstStageTitle).toBeInTheDocument();
    expect(
      within(firstStageTitle.closest(".relative") as HTMLElement).getAllByText("已通过").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("阶段2：发起部门负责人")).toBeInTheDocument();
    expect(screen.queryByText(/PM成本\/设计负责人/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PMCC26002/)).not.toBeInTheDocument();
    expect(screen.queryByText("提交")).not.toBeInTheDocument();
  });

  it("shows every project approver beside its status without repeating names in the stage hint", () => {
    const node = baseNode({
      scope_type: "timesheet",
      scope_id: null,
      project_code: null,
      project_name: null,
      assignees: [
        {
          node_id: 1,
          node_status: "approved",
          project_id: 101,
          project_code: "P001",
          project_name: "一号项目",
          assignee_user_id: 10,
          assignee_name: "张三",
          status: "approved",
          action: "approve",
          acted_at: "2026-07-01T08:00:00Z",
        },
        {
          node_id: 1,
          node_status: "active",
          project_id: 102,
          project_code: "P002",
          project_name: "二号项目",
          assignee_user_id: 11,
          assignee_name: "李四",
          status: "pending",
        },
        {
          node_id: 1,
          node_status: "active",
          project_id: 102,
          project_code: "P002",
          project_name: "二号项目",
          assignee_user_id: 41,
          assignee_name: "庞红照",
          status: "cancelled",
          action: "cancelled",
          acted_at: "2026-06-30T08:00:00Z",
          comment: "route repair",
        },
      ],
    });

    render(<ApprovalChain nodes={[node]} />);

    expect(screen.getByText("P001 一号项目")).toBeInTheDocument();
    expect(screen.getByText("P002 二号项目")).toBeInTheDocument();
    expect(screen.queryByText("审批人")).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("P001 一号项目审批状态")).getByText("张三")).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("P001 一号项目审批状态")).getByText(
        formatApprovalAuditTime("2026-07-01T08:00:00Z"),
      ),
    ).toBeInTheDocument();
    expect(within(screen.getByLabelText("P002 二号项目审批状态")).getByText("李四")).toBeInTheDocument();
    expect(screen.queryByText("庞红照")).not.toBeInTheDocument();
    expect(screen.queryByText(/当前审批阶段/)).not.toBeInTheDocument();
  });

  it("does not let a non-applicable project mark waiting projects as approved", () => {
    const node = baseNode({
      node_name: "PM部门负责人",
      node_status: "waiting",
      result_action: "skipped",
      comment: "Not applicable for project business type",
      assignees: [
        {
          node_id: 1,
          node_status: "waiting",
          project_id: 101,
          project_code: "PMCC26002",
          project_name: "海昌项目",
          assignee_user_id: 20,
          assignee_name: "那钦",
          status: "waiting",
        },
        {
          node_id: 2,
          node_status: "skipped",
          project_id: 102,
          project_code: "P010",
          project_name: "北运河项目",
          assignee_user_id: 0,
          assignee_name: null,
          status: "skipped",
          action: "skipped",
          comment: "Not applicable for project business type",
        },
      ],
    });

    render(<ApprovalChain nodes={[node]} />);

    const waitingRow = screen.getByLabelText("PMCC26002 海昌项目审批状态");
    const skippedRow = screen.getByLabelText("P010 北运河项目审批状态");
    expect(within(waitingRow).getByText("那钦")).toBeInTheDocument();
    expect(within(waitingRow).getByText("待审核")).toBeInTheDocument();
    expect(within(skippedRow).getByText("无需审批")).toBeInTheDocument();
    expect(within(skippedRow).getByText("已通过")).toBeInTheDocument();
  });
});

describe("ApprovalRecords", () => {
  it("keeps cancelled route candidates in audit records while the chain hides them", () => {
    const node = baseNode({
      assignees: [
        {
          node_id: 1,
          node_status: "active",
          project_id: 101,
          project_code: "P001",
          project_name: "一号项目",
          assignee_user_id: 41,
          assignee_name: "庞红照",
          status: "cancelled",
          action: "cancelled",
          acted_at: "2026-06-30T08:00:00Z",
          comment: "route repair",
        },
      ],
    });

    render(<ApprovalRecords nodes={[node]} projectId={101} />);

    expect(screen.getByText("庞红照")).toBeInTheDocument();
    expect(screen.getByText("route repair")).toBeInTheDocument();
  });

  it("excludes future assignees and keeps real historical records", () => {
    const nodes = [
      baseNode({
        node_id: 1,
        node_key: "lead",
        node_status: "approved",
        assignees: [
          {
            node_id: 1,
            node_status: "approved",
            project_id: 101,
            project_code: "P001",
            project_name: "一号项目",
            assignee_user_id: 10,
            assignee_name: "张三",
            status: "approved",
            action: "approve",
            acted_at: "2026-07-01T08:00:00Z",
          },
        ],
      }),
      baseNode({
        node_id: 2,
        node_key: "department",
        node_name: "部门负责人",
        node_status: "waiting",
        assignees: [
          {
            node_id: 2,
            node_status: "waiting",
            project_id: 101,
            project_code: "P001",
            project_name: "一号项目",
            assignee_user_id: 11,
            assignee_name: "李四",
            status: "pending",
          },
        ],
      }),
    ];

    render(<ApprovalRecords nodes={nodes} projectId={101} />);

    expect(screen.getByText(/张三/)).toBeInTheDocument();
    expect(screen.queryByText("李四")).not.toBeInTheDocument();
    expect(screen.queryByText("部门负责人")).not.toBeInTheDocument();
  });

  it("shows route source and explicit status on record cards", () => {
    const node = baseNode({
      node_status: "approved",
      assignees: [
        {
          node_id: 1,
          node_status: "approved",
          project_id: 101,
          project_code: "P001",
          project_name: "一号项目",
          assignee_user_id: 10,
          assignee_name: "张三",
          assignee_route_source: "project_roles:lead",
          status: "approved",
          action: "approve",
          acted_at: "2026-07-01T08:00:00Z",
        },
      ],
    } as unknown as ApprovalChainNode);

    render(<ApprovalRecords nodes={[node]} projectId={101} />);

    const card = screen.getByRole("article");
    expect(within(card).getByText("来源：project_roles:lead")).toBeInTheDocument();
    expect(within(card).getByText("状态：已通过")).toBeInTheDocument();
  });
});
