import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApprovalChain, ApprovalRecords } from "./ApprovalChain";
import type { ApprovalChainNode } from "@/types/approval";

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
  it("shows project block statuses from assignees without exposing approvers as node fields", () => {
    const node = baseNode({
      scope_type: "timesheet",
      scope_id: null,
      project_code: null,
      project_name: null,
      assignees: [
        {
          node_id: 1,
          node_status: "active",
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
      ],
    });

    render(<ApprovalChain nodes={[node]} />);

    expect(screen.getByText("P001 一号项目")).toBeInTheDocument();
    expect(screen.getByText("P002 二号项目")).toBeInTheDocument();
    expect(screen.queryByText("审批人")).not.toBeInTheDocument();
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
  });
});

describe("ApprovalRecords", () => {
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
