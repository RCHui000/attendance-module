import type {
  DashboardAnalysisData,
  DashboardAnalysisEmployee,
  DashboardAnalysisProject,
  DashboardAnalysisSort,
  DashboardAnalysisSource,
  DashboardAnalysisTrendPoint,
} from "@/types/project";

export type AnalysisView = "project" | "employee" | "department";

export type AnalysisBreakdownItem = {
  id: string;
  name: string;
  meta?: string;
  labor_days: number;
  labor_cost: number;
  people_count?: number;
  project_count?: number;
  timesheet_count?: number;
};

export type AnalysisTrendItem = {
  bucket_start: string;
  bucket_label: string;
  labor_days: number;
  labor_cost: number;
  people_count: number;
};

export type AnalysisEntity = {
  id: string;
  view: AnalysisView;
  title: string;
  subtitle: string;
  badge?: string;
  searchText: string;
  labor_days: number;
  labor_cost: number;
  people_count: number;
  project_count: number;
  department_count: number;
  timesheet_count: number;
  labor_days_delta: number;
  planned_labor_days: number;
  labor_budget_amount: number;
  contract_amount: number;
  labor_days_used_ratio: number | null;
  labor_budget_used_ratio: number | null;
  labor_cost_contract_ratio: number | null;
  sortValues: Record<DashboardAnalysisSort, number>;
  sources: DashboardAnalysisSource[];
  employees: DashboardAnalysisEmployee[];
  departments: AnalysisBreakdownItem[];
  projects: AnalysisBreakdownItem[];
  trend: AnalysisTrendItem[];
};

function numberValue(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function uniqueCount<T>(items: T[], getKey: (item: T) => string | number | null | undefined) {
  const values = new Set<string>();
  items.forEach((item) => {
    const value = getKey(item);
    if (value != null && value !== "") values.add(String(value));
  });
  return values.size;
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = getKey(item);
    const current = groups.get(key);
    if (current) current.push(item);
    else groups.set(key, [item]);
  });
  return groups;
}

function sourceTimesheetCount(sources: DashboardAnalysisSource[]) {
  return uniqueCount(sources, (source) => source.timesheet_id);
}

function makeTrendFromSources(sources: DashboardAnalysisSource[], knownBuckets: DashboardAnalysisTrendPoint[]) {
  const bucketLabels = new Map<string, string>();
  knownBuckets.forEach((item) => bucketLabels.set(item.bucket_start, item.bucket_label));

  return Array.from(groupBy(sources, (source) => source.week_start_date))
    .map(([bucketStart, bucketSources]) => ({
      bucket_start: bucketStart,
      bucket_label: bucketLabels.get(bucketStart) || bucketStart.slice(5),
      labor_days: bucketSources.reduce((sum, source) => sum + numberValue(source.total_hours), 0),
      labor_cost: bucketSources.reduce((sum, source) => sum + numberValue(source.labor_cost), 0),
      people_count: uniqueCount(bucketSources, (source) => source.employee_id),
    }))
    .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
}

function makeProjectBreakdown(sources: DashboardAnalysisSource[]): AnalysisBreakdownItem[] {
  return Array.from(groupBy(sources, (source) => String(source.project_id)))
    .map(([projectId, projectSources]) => ({
      id: projectId,
      name: projectSources[0]?.project_name || "未命名项目",
      meta: projectSources[0]?.project_code,
      labor_days: projectSources.reduce((sum, source) => sum + numberValue(source.total_hours), 0),
      labor_cost: projectSources.reduce((sum, source) => sum + numberValue(source.labor_cost), 0),
      people_count: uniqueCount(projectSources, (source) => source.employee_id),
      timesheet_count: sourceTimesheetCount(projectSources),
    }))
    .sort((a, b) => b.labor_days - a.labor_days || a.name.localeCompare(b.name));
}

function makeDepartmentBreakdown(sources: DashboardAnalysisSource[]): AnalysisBreakdownItem[] {
  return Array.from(groupBy(sources, (source) => source.department || "未分配部门"))
    .map(([department, departmentSources]) => ({
      id: department,
      name: department,
      labor_days: departmentSources.reduce((sum, source) => sum + numberValue(source.total_hours), 0),
      labor_cost: departmentSources.reduce((sum, source) => sum + numberValue(source.labor_cost), 0),
      people_count: uniqueCount(departmentSources, (source) => source.employee_id),
      project_count: uniqueCount(departmentSources, (source) => source.project_id),
      timesheet_count: sourceTimesheetCount(departmentSources),
    }))
    .sort((a, b) => b.labor_days - a.labor_days || a.name.localeCompare(b.name));
}

function makeEmployeeBreakdown(sources: DashboardAnalysisSource[]): DashboardAnalysisEmployee[] {
  return Array.from(groupBy(sources, (source) => String(source.employee_id)))
    .map(([employeeId, employeeSources]) => ({
      project_id: 0,
      project_code: "",
      project_name: "",
      employee_id: Number(employeeId),
      employee_name: employeeSources[0]?.employee_name || "未命名员工",
      department: employeeSources[0]?.department || "未分配部门",
      labor_days: employeeSources.reduce((sum, source) => sum + numberValue(source.total_hours), 0),
      work_days: employeeSources.reduce((sum, source) => sum + numberValue(source.work_days), 0),
      daily_rate: 0,
      labor_cost: employeeSources.reduce((sum, source) => sum + numberValue(source.labor_cost), 0),
      project_count: uniqueCount(employeeSources, (source) => source.project_id),
    }))
    .sort((a, b) => b.labor_days - a.labor_days || a.employee_name.localeCompare(b.employee_name));
}

function makeProjectEntity(
  project: DashboardAnalysisProject,
  data: DashboardAnalysisData,
): AnalysisEntity {
  const sources = data.sources.filter((source) => source.project_id === project.project_id);
  const employees = data.employees
    .filter((item) => item.project_id === project.project_id)
    .sort((a, b) => b.labor_days - a.labor_days || a.employee_name.localeCompare(b.employee_name));
  const departments = data.departments
    .filter((item) => item.project_id === project.project_id)
    .map((item) => ({
      id: item.department,
      name: item.department,
      labor_days: numberValue(item.labor_days),
      labor_cost: numberValue(item.labor_cost),
      people_count: item.people_count,
      timesheet_count: item.timesheet_count,
    }))
    .sort((a, b) => b.labor_days - a.labor_days || a.name.localeCompare(b.name));
  const trend = data.trend
    .filter((item) => item.project_id === project.project_id)
    .map((item) => ({
      bucket_start: item.bucket_start,
      bucket_label: item.bucket_label,
      labor_days: numberValue(item.labor_days),
      labor_cost: numberValue(item.labor_cost),
      people_count: numberValue(item.people_count),
    }));

  return {
    id: String(project.project_id),
    view: "project",
    title: project.project_name,
    subtitle: `${project.department_count} 个部门 · ${project.people_count} 人 · ${project.timesheet_count} 份周表`,
    badge: project.project_code,
    searchText: `${project.project_code} ${project.project_name}`.toLowerCase(),
    labor_days: numberValue(project.labor_days),
    labor_cost: numberValue(project.labor_cost),
    people_count: numberValue(project.people_count),
    project_count: 1,
    department_count: numberValue(project.department_count),
    timesheet_count: numberValue(project.timesheet_count),
    labor_days_delta: numberValue(project.labor_days_delta),
    planned_labor_days: numberValue(project.planned_labor_days),
    labor_budget_amount: numberValue(project.labor_budget_amount),
    contract_amount: numberValue(project.contract_amount),
    labor_days_used_ratio: project.labor_days_used_ratio,
    labor_budget_used_ratio: project.labor_budget_used_ratio,
    labor_cost_contract_ratio: project.labor_cost_contract_ratio,
    sortValues: {
      labor_days: numberValue(project.labor_days),
      labor_days_used_ratio: numberValue(project.labor_days_used_ratio),
      labor_cost: numberValue(project.labor_cost),
      labor_days_delta: numberValue(project.labor_days_delta),
    },
    sources,
    employees,
    departments,
    projects: [{
      id: String(project.project_id),
      name: project.project_name,
      meta: project.project_code,
      labor_days: numberValue(project.labor_days),
      labor_cost: numberValue(project.labor_cost),
      people_count: numberValue(project.people_count),
      timesheet_count: numberValue(project.timesheet_count),
    }],
    trend,
  };
}

function makeEmployeeEntity(employeeId: string, sources: DashboardAnalysisSource[], data: DashboardAnalysisData): AnalysisEntity {
  const first = sources[0];
  const laborDays = sources.reduce((sum, source) => sum + numberValue(source.total_hours), 0);
  const laborCost = sources.reduce((sum, source) => sum + numberValue(source.labor_cost), 0);
  const projects = makeProjectBreakdown(sources);
  const departments = makeDepartmentBreakdown(sources);

  return {
    id: employeeId,
    view: "employee",
    title: first?.employee_name || "未命名员工",
    subtitle: `${first?.department || "未分配部门"} · ${projects.length} 个项目 · ${sourceTimesheetCount(sources)} 份周表`,
    badge: first?.department,
    searchText: `${first?.employee_name || ""} ${first?.department || ""} ${projects.map((item) => item.name).join(" ")}`.toLowerCase(),
    labor_days: laborDays,
    labor_cost: laborCost,
    people_count: 1,
    project_count: projects.length,
    department_count: departments.length,
    timesheet_count: sourceTimesheetCount(sources),
    labor_days_delta: 0,
    planned_labor_days: 0,
    labor_budget_amount: 0,
    contract_amount: projects.reduce((sum, project) => sum + numberValue(project.labor_cost), 0),
    labor_days_used_ratio: data.summary.labor_days > 0 ? laborDays / data.summary.labor_days : null,
    labor_budget_used_ratio: null,
    labor_cost_contract_ratio: null,
    sortValues: {
      labor_days: laborDays,
      labor_days_used_ratio: data.summary.labor_days > 0 ? laborDays / data.summary.labor_days : 0,
      labor_cost: laborCost,
      labor_days_delta: projects.length,
    },
    sources,
    employees: makeEmployeeBreakdown(sources),
    departments,
    projects,
    trend: makeTrendFromSources(sources, data.trend),
  };
}

function makeDepartmentEntity(department: string, sources: DashboardAnalysisSource[], data: DashboardAnalysisData): AnalysisEntity {
  const laborDays = sources.reduce((sum, source) => sum + numberValue(source.total_hours), 0);
  const laborCost = sources.reduce((sum, source) => sum + numberValue(source.labor_cost), 0);
  const projects = makeProjectBreakdown(sources);
  const employees = makeEmployeeBreakdown(sources);

  return {
    id: department,
    view: "department",
    title: department,
    subtitle: `${employees.length} 人 · ${projects.length} 个项目 · ${sourceTimesheetCount(sources)} 份周表`,
    badge: "部门",
    searchText: `${department} ${employees.map((item) => item.employee_name).join(" ")} ${projects.map((item) => item.name).join(" ")}`.toLowerCase(),
    labor_days: laborDays,
    labor_cost: laborCost,
    people_count: employees.length,
    project_count: projects.length,
    department_count: 1,
    timesheet_count: sourceTimesheetCount(sources),
    labor_days_delta: 0,
    planned_labor_days: 0,
    labor_budget_amount: 0,
    contract_amount: 0,
    labor_days_used_ratio: data.summary.labor_days > 0 ? laborDays / data.summary.labor_days : null,
    labor_budget_used_ratio: null,
    labor_cost_contract_ratio: null,
    sortValues: {
      labor_days: laborDays,
      labor_days_used_ratio: data.summary.labor_days > 0 ? laborDays / data.summary.labor_days : 0,
      labor_cost: laborCost,
      labor_days_delta: employees.length,
    },
    sources,
    employees,
    departments: [{
      id: department,
      name: department,
      labor_days: laborDays,
      labor_cost: laborCost,
      people_count: employees.length,
      project_count: projects.length,
      timesheet_count: sourceTimesheetCount(sources),
    }],
    projects,
    trend: makeTrendFromSources(sources, data.trend),
  };
}

export function buildAnalysisEntities(data: DashboardAnalysisData, view: AnalysisView): AnalysisEntity[] {
  if (view === "project") {
    return data.projects.map((project) => makeProjectEntity(project, data));
  }

  if (view === "employee") {
    return Array.from(groupBy(data.sources, (source) => String(source.employee_id)))
      .map(([employeeId, sources]) => makeEmployeeEntity(employeeId, sources, data))
      .sort((a, b) => b.labor_days - a.labor_days || a.title.localeCompare(b.title));
  }

  return Array.from(groupBy(data.sources, (source) => source.department || "未分配部门"))
    .map(([department, sources]) => makeDepartmentEntity(department, sources, data))
    .sort((a, b) => b.labor_days - a.labor_days || a.title.localeCompare(b.title));
}

export function getAnalysisEntityParam(view: AnalysisView) {
  if (view === "employee") return "employeeId";
  if (view === "department") return "department";
  return "projectId";
}

export function getAnalysisViewLabel(view: AnalysisView) {
  if (view === "employee") return "人员";
  if (view === "department") return "部门";
  return "项目";
}
