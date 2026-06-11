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

export type ProjectBusinessType = "PM" | "CC" | "PMCC";

export interface ProjectRoleAssignment {
  id?: number;
  project_id?: number;
  role_key: string;
  user_id: number;
  employee_id?: number;
  user_name?: string;
  status?: string;
}

export interface ProjectBase {
  id: number;
  code: string;
  name: string;
  business_type: ProjectBusinessType | null;
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
