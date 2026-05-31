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

export interface ProjectBase {
  id: number;
  code: string;
  name: string;
  contract_amount: number;
  received_amount: number;
  receivable_amount: number;
  owner_org_id: number | null;
  owner_org_name: string | null;
  project_owner_id: number | null;
  project_owner_name: string | null;
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
