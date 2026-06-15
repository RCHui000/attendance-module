import type { PlatformRole } from "@/types/auth";

export interface Employee {
  id: number;
  name: string;
  role: PlatformRole;
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

export interface PermissionRole {
  role_key: PlatformRole;
  role_name: string;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
}

export interface PermissionResource {
  resource_key: string;
  resource_name: string;
  resource_group: "sidebar" | "employee_org" | string;
  sort_order: number;
  is_active: boolean;
}

export interface RolePermission {
  role_key: PlatformRole;
  resource_key: string;
  access_level: "none" | "read" | "write";
  sidebar_order?: number;
}

export interface PermissionConfig {
  roles: PermissionRole[];
  resources: PermissionResource[];
  permissions: RolePermission[];
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
