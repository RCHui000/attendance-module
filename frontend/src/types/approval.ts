export interface ApprovalTasks {
  timesheets: ApprovalTaskItem[];
  inProgress: ApprovalTaskItem[];
  reviewed: ReviewedTaskItem[];
  overtime: ApprovalOvertimeItem[];
  overtimeReviewed: ApprovalOvertimeItem[];
}

export interface ApprovalTaskItem {
  task_id?: number;
  timesheet_id: number;
  user_id: number;
  name: string;
  department: string;
  department_color_token?: string | null;
  status: string;
  assignee_role?: string;
  scope_type?: string;
  scope_id?: number | null;
  project_id?: number | null;
  project_code?: string;
  project_name?: string;
  total_hours: number;
  submitted_at: string;
  week_start_date: string;
  current_assignee_names?: string;
  current_nodes?: Array<{
    node_id: number;
    node_name: string;
    scope_type?: string | null;
    scope_id?: number | null;
    node_status: string;
  }>;
}

export interface ReviewedTaskItem {
  task_id?: number;
  timesheet_id: number;
  user_id: number;
  name: string;
  department: string;
  department_color_token?: string | null;
  status: string;
  assignee_role?: string;
  scope_type?: string;
  scope_id?: number | null;
  project_id?: number | null;
  project_code?: string;
  project_name?: string;
  total_hours: number;
  review_comment: string;
  week_start_date: string;
}

export interface ApprovalOvertimeItem {
  id: number;
  user_name: string;
  work_date: string;
  overtime_hours: number;
  reason: string;
  status: string;
  reject_comment: string;
}

export interface TimesheetDetail {
  id: number;
  user_name: string;
  department: string;
  week_start_date: string;
  status: string;
  remark: string;
  days: string[];
  entries: TimesheetDetailEntry[];
  overtime: TimesheetDetailOvertime[];
  project_statuses?: {
    project_id: number;
    status: string;
    assignee_role?: string;
    completed_at?: string;
  }[];
  approval_chain?: ApprovalChainNode[];
  approval_chain_error?: boolean;
}

export type ApprovalChainStatus =
  | "waiting"
  | "active"
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "skipped"
  | "waiting_revision"
  | "needs_revision"
  | "needs_reapproval";

export type ApprovalChainAction =
  | "approve"
  | "approved"
  | "reject"
  | "rejected"
  | "delegate"
  | "delegated"
  | "skip"
  | "skipped"
  | "cancel"
  | "cancelled"
  | "submit"
  | "withdraw"
  | "reopen";

export interface ApprovalChainAssignee {
  node_id?: number | null;
  node_name?: string | null;
  node_status?: ApprovalChainStatus | string | null;
  project_id?: number | null;
  project_code?: string | null;
  project_name?: string | null;
  assignee_user_id: number;
  assignee_name?: string | null;
  status: ApprovalChainStatus | string;
  action?: ApprovalChainAction | string | null;
  comment?: string | null;
  acted_at?: string | null;
}

export interface ApprovalChainNode {
  node_id: number;
  node_key: string;
  node_name: string;
  scope_type?: string | null;
  scope_id?: number | null;
  node_status: ApprovalChainStatus | string;
  assignee_role?: string | null;
  resolver_role?: string | null;
  approval_policy?: string | null;
  project_code?: string | null;
  project_name?: string | null;
  sort_order: number;
  activated_at?: string | null;
  completed_at?: string | null;
  result_action?: ApprovalChainAction | string | null;
  comment?: string | null;
  can_current_user_act: boolean;
  assignees: ApprovalChainAssignee[];
  blocking_nodes: Array<{
    node_id: number;
    node_name: string;
    status: ApprovalChainStatus | string;
  }>;
}

export interface ApprovalTemplateNode {
  id: number;
  template_id: number;
  node_key: string;
  node_name: string;
  node_type: string;
  resolver_type: string;
  resolver_role: string | null;
  approval_policy: string;
  reject_policy: string;
  sort_order: number;
}

export interface ApprovalTemplateEdge {
  id: number;
  template_id: number;
  from_node_key: string;
  to_node_key: string;
  edge_type: string;
  condition_expr: Record<string, unknown>;
}

export interface ApprovalTemplate {
  id: number;
  template_key: string;
  document_type: string;
  business_type: "PM" | "CC" | "PMCC" | null;
  name: string;
  version: number;
  status: string;
  nodes: ApprovalTemplateNode[];
  edges: ApprovalTemplateEdge[];
}

export interface TimesheetDetailEntry {
  project_id: number;
  project_name: string;
  work_date: string;
  hours: number;
}

export interface TimesheetDetailOvertime {
  work_date: string;
  overtime_hours: number;
  reason?: string;
  status?: string;
}
