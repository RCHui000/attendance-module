export interface ApprovalTasks {
  timesheets: ApprovalTaskItem[];
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
}

export interface ReviewedTaskItem {
  task_id?: number;
  timesheet_id: number;
  user_id: number;
  name: string;
  department: string;
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
