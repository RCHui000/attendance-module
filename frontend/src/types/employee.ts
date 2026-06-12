export interface Employee {
  id: number;
  name: string;
  role: "employee" | "manager" | "admin" | "hr";
  employee_no: string;
  org_id: number | null;
  org_name: string;
  department: string;
  position_name: string;
  cost_specialty: "civil" | "mep" | "";
  contract_type: "labor" | "service";
  monthly_salary: string;
  daily_wage: string;
  hire_date: string;
  contract_start: string;
  contract_end: string;
  manager_user_id: number | null;
  manager_name: string | null;
  employment_type: string;
  status: "active" | "terminated";
  standard_monthly_workdays: number;
}

export interface Organization {
  id: number;
  org_code: string;
  org_name: string;
  parent_id: number | null;
  org_type: "company" | "department";
  manager_user_id: number | null;
  manager_name?: string;
  member_count?: number;
  status: string;
}
