export interface DashboardData {
  projects: DashboardProject[];
  totalLaborHours: number;
  totalLaborCost: number;
  totalPeople: number;
}

export interface DashboardProject {
  id: number;
  code: string;
  name: string;
  contract_amount: number;
  received_amount: number;
  receivable_amount: number;
  labor_days: number;
  labor_cost: number;
  gross_profit: number;
  gross_margin: number;
  people_count: number;
  planned_labor_days?: number;
  labor_budget_amount?: number;
}

export type DashboardAnalysisGrain = "week" | "month";
export type DashboardAnalysisSort =
  | "labor_days"
  | "labor_days_used_ratio"
  | "labor_cost"
  | "labor_days_delta";

export interface DashboardAnalysisSummary {
  start_date: string;
  end_date: string;
  grain: DashboardAnalysisGrain;
  project_count: number;
  employee_count: number;
  department_count: number;
  timesheet_count: number;
  labor_days: number;
  labor_cost: number;
}

export interface DashboardAnalysisProject {
  project_id: number;
  project_code: string;
  project_name: string;
  contract_amount: number;
  received_amount: number;
  receivable_amount: number;
  planned_labor_days: number;
  labor_budget_amount: number;
  labor_days: number;
  labor_cost: number;
  people_count: number;
  department_count: number;
  timesheet_count: number;
  previous_labor_days: number;
  labor_days_delta: number;
  labor_days_used_ratio: number | null;
  labor_budget_used_ratio: number | null;
  labor_cost_contract_ratio: number | null;
}

export interface DashboardAnalysisDepartment {
  project_id: number;
  project_code: string;
  project_name: string;
  department: string;
  labor_days: number;
  labor_cost: number;
  people_count: number;
  timesheet_count: number;
}

export interface DashboardAnalysisEmployee {
  project_id: number;
  project_code: string;
  project_name: string;
  employee_id: number;
  employee_name: string;
  department: string;
  labor_days: number;
  work_days: number;
  daily_rate: number;
  labor_cost: number;
  project_count: number;
}

export interface DashboardAnalysisTrendPoint {
  bucket_start: string;
  bucket_label: string;
  project_id: number;
  project_code: string;
  project_name: string;
  labor_days: number;
  labor_cost: number;
  people_count: number;
}

export interface DashboardAnalysisSource {
  timesheet_id: number;
  project_id: number;
  project_code: string;
  project_name: string;
  work_kind: "project";
  employee_id: number;
  employee_name: string;
  department: string;
  week_start_date: string;
  timesheet_status: string;
  submitted_at: string | null;
  total_hours: number;
  work_days: number;
  labor_cost: number;
}

export interface DashboardAnalysisData {
  summary: DashboardAnalysisSummary;
  projects: DashboardAnalysisProject[];
  departments: DashboardAnalysisDepartment[];
  employees: DashboardAnalysisEmployee[];
  trend: DashboardAnalysisTrendPoint[];
  sources: DashboardAnalysisSource[];
}

export interface ReportData {
  projects: ReportProject[];
  employees: ReportEmployee[];
  startDate: string;
  endDate: string;
}

export interface ReportProject {
  id?: number;   // backend weekly_report may omit this field
  code: string;
  name: string;
  people_count: number;
  total_hours: number;
}

export interface ReportEmployee {
  id: number;
  name: string;
  total_hours: number;
}

export interface LaborMatrixRow {
  employee_id: number;
  employee_name: string;
  department: string;
  project_id: number;
  project_code: string;
  project_name: string;
  total_hours: number;
  work_days: number;
  daily_rate: number;
  labor_cost: number;
}

export interface ProjectDepartmentOwner {
  id?: number;
  project_id?: number;
  org_id: number;
  org_name?: string;
  project_owner_id: number;
  project_owner_name?: string;
  role_key?: string;
  is_active?: boolean;
}

export type ProjectBusinessType = "PM" | "CONSULTING" | "PMCC";
export type ProjectWorkKind = "project" | "leave";

export interface ProjectRoleAssignment {
  id?: number;
  project_id?: number;
  role_key: string;
  user_id: number;
  employee_id?: number;
  user_name?: string;
  status?: string;
}

export type ProjectRoleKey =
  | "cc_civil_project_owner"
  | "cc_mep_project_owner"
  | "cc_project_owner"
  | "cc_design_project_owner"
  | "cc_department_owner"
  | "pm_cost_department_owner"
  | "pm_design_project_owner"
  | "pm_project_owner"
  | "pm_department_owner";

export interface ProjectRoleRequirement {
  id: number;
  business_type: ProjectBusinessType;
  role_key: ProjectRoleKey;
  role_label: string;
  sort_order: number;
  is_required: boolean;
  fallback_role_key?: ProjectRoleKey | null;
  is_active: boolean;
}

export interface ProjectBase {
  id: number;
  code: string;
  name: string;
  signed_date?: string | null;
  business_type: ProjectBusinessType | null;
  work_kind: ProjectWorkKind;
  planned_labor_days: number;
  labor_budget_amount: number;
  contract_amount: number;
  received_amount: number;
  receivable_amount: number;
  owner_org_id: number | null;
  owner_org_name: string | null;
  project_owner_id: number | null;
  project_owner_name: string | null;
  department_owners?: ProjectDepartmentOwner[];
  project_roles?: ProjectRoleAssignment[];
  total_labor_hours: number;
  total_labor_cost: number;
  status: string;
}

export interface ProjectDetailEmployee {
  name: string;
  department: string;
  total_hours: number;
  work_days: number;
}
