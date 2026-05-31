export interface CurrentUser {
  id: number;
  name: string;
  role: "employee" | "manager" | "admin";
  department: string;
  is_active: number;
}

export interface UserBrief {
  id: number;
  name: string;
  role: string;
  department: string;
}

export interface BootstrapData {
  currentUser: CurrentUser | null;
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
