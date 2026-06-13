export type PlatformRole = "employee" | "lead" | "manager" | "director" | "admin";
export type PermissionAccess = "none" | "read" | "write";
export type PermissionMap = Record<string, PermissionAccess>;

export interface CurrentUser {
  id: number;
  name: string;
  role: PlatformRole;
  department: string;
  is_active: number;
  permissions?: PermissionMap;
}

export interface UserBrief {
  id: number;
  name: string;
  role: string;
  department: string;
}

export interface BootstrapData {
  currentUser: CurrentUser | null;
  permissions: PermissionMap;
  users: UserBrief[];
  projects: ProjectBrief[];
  currentWeek: string;
  dbRecommendation: string;
}

export interface ProjectBrief {
  id: number;
  code: string;
  name: string;
}
