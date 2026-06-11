export type TimesheetStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "revision_required"
  | "locked"
  | "summarized";

export interface Timesheet {
  id: number;
  user_id: number;
  week_start_date: string;
  status: TimesheetStatus;
  remark: string;
  days: string[];
  entries: TimesheetEntry[];
  overtime: OvertimeEntry[];
  project_statuses?: TimesheetProjectStatus[];
}

export interface TimesheetEntry {
  id?: number;
  timesheet_id?: number;
  project_id: number;
  project_name?: string;
  project_code?: string;
  work_date: string;
  hours: number;
  description?: string;
}

export interface OvertimeEntry {
  id?: number;
  timesheet_id?: number;
  work_date: string;
  overtime_hours: number;
  reason?: string;
  status?: string;
  reject_comment?: string;
}

export interface TimesheetRow {
  projectId: number;
  percents: Record<string, number>; // "YYYY-MM-DD" -> percent 0-100
  descriptions: Record<string, string>;
  approvalStatus?: "draft" | "pending" | "approved" | "rejected" | "summary_pending";
  approvalRole?: string;
  approvedAt?: string;
}

export interface TimesheetProjectStatus {
  project_id: number;
  status: "draft" | "pending" | "approved" | "rejected" | "summary_pending";
  assignee_role?: string;
  result_action?: string;
  completed_at?: string;
}

export interface OvertimeStore {
  hours: number;
  reason: string;
  status: string;
  rejectComment: string;
}

export interface SaveTimesheetPayload {
  weekStart: string;
  remark: string;
  entries: SaveEntry[];
  overtime: SaveOvertime[];
}

export interface SaveEntry {
  projectId: number;
  workDate: string;
  hours: number;
  description: string;
}

export interface SaveOvertime {
  workDate: string;
  hours: number;
  reason: string;
}
