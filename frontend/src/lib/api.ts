import { getStoredToken, setStoredToken, clearStoredToken } from "./supabase";

const CLIENT_ID = crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;

const AUTH_URL =
  import.meta.env.VITE_SUPABASE_AUTH_URL ||
  import.meta.env.VITE_SUPABASE_URL ||
  "/auth";

const REST_URL =
  import.meta.env.VITE_SUPABASE_REST_URL ||
  (AUTH_URL.startsWith("http")
    ? AUTH_URL.replace(":8777", ":8779").replace(/\/auth\/v1\/?$/, "/rest/v1")
    : "/rest");

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

// PostgREST embeds related rows dynamically, so this compatibility layer keeps row shapes open.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;
const REPORTABLE_TIMESHEET_STATUSES = new Set(["approved", "locked", "summarized"]);
const MAX_TIMESHEET_DAY_HOURS = 1;
const MAX_TIMESHEET_WEEK_HOURS = 7;
const TIMESHEET_HOURS_EPSILON = 0.0001;

function formatApiHours(value: number): string {
  const roundedToOne = Number(value.toFixed(1));
  return Math.abs(value - roundedToOne) > TIMESHEET_HOURS_EPSILON
    ? value.toFixed(2)
    : value.toFixed(1);
}

function assertTimesheetHoursWithinLimits(entries: AnyRow[]): void {
  const daily = new Map<string, number>();
  let weekly = 0;

  for (const entry of entries) {
    const hours = Number(entry.hours || 0);
    if (hours < 0) {
      throw new Error("普通工日不能为负数");
    }
    if (hours > MAX_TIMESHEET_DAY_HOURS + TIMESHEET_HOURS_EPSILON) {
      throw new Error(
        `${entry.work_date} 单项目普通工日 ${formatApiHours(hours)}，超过 1.0 工日`,
      );
    }
    const day = String(entry.work_date);
    daily.set(day, (daily.get(day) || 0) + hours);
    weekly += hours;
  }

  for (const [day, hours] of daily) {
    if (hours > MAX_TIMESHEET_DAY_HOURS + TIMESHEET_HOURS_EPSILON) {
      throw new Error(
        `${day} 普通工日合计 ${formatApiHours(hours)}，超过 1.0 工日`,
      );
    }
  }

  if (weekly > MAX_TIMESHEET_WEEK_HOURS + TIMESHEET_HOURS_EPSILON) {
    throw new Error(
      `本周普通工日合计 ${formatApiHours(weekly)}，超过 ${MAX_TIMESHEET_WEEK_HOURS.toFixed(1)} 工日`,
    );
  }
}

function authHeaders(json = true): Record<string, string> {
  const token = getStoredToken();
  const bearer = token || ANON_KEY;
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(ANON_KEY ? { apikey: ANON_KEY } : {}),
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  };
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${REST_URL}${path}`, {
    ...init,
    headers: {
      ...authHeaders(init.body != null),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.hint || text || "Supabase request failed");
  }
  return data as T;
}

function payload(options: RequestInit): AnyRow {
  if (!options.body) return {};
  return typeof options.body === "string" ? JSON.parse(options.body) : options.body as AnyRow;
}

function decodeJwt(): AnyRow | null {
  const token = getStoredToken();
  if (!token) return null;
  try {
    const [, body] = token.split(".");
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

function todayMonday(): string {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function weekDays(weekStart: string): string[] {
  const start = new Date(`${weekStart}T00:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day.toISOString().slice(0, 10);
  });
}

function projectStatusFromTasks(sheet: AnyRow, tasks: AnyRow[]): AnyRow[] {
  const projectIds = new Set<number>();
  for (const task of tasks) {
    if (task.scope_type === "project" && task.scope_id) {
      projectIds.add(Number(task.scope_id));
    }
  }
  return Array.from(projectIds).map((projectId) => {
    const pending = tasks.find(
      (task) =>
        task.scope_type === "project" &&
        Number(task.scope_id) === projectId &&
        task.status === "pending",
    );
    const approved = tasks.find(
      (task) =>
        task.scope_type === "project" &&
        Number(task.scope_id) === projectId &&
        task.status === "completed" &&
        task.result_action === "approve",
    );
    const rejected = tasks.find(
      (task) =>
        task.scope_type === "project" &&
        Number(task.scope_id) === projectId &&
        task.status === "completed" &&
        task.result_action === "reject",
    );
    const summaryPending = tasks.some(
      (task) => task.scope_type === "department_summary" && task.status === "pending",
    );
    const source = pending || approved || rejected;
    return {
      project_id: projectId,
      status: pending
        ? "pending"
        : approved
          ? summaryPending
            ? "summary_pending"
            : "approved"
          : rejected
            ? "rejected"
            : sheet.status === "submitted"
              ? "pending"
              : "draft",
      assignee_role: source?.assignee_role || "",
      result_action: source?.result_action || "",
      completed_at: source?.completed_at || "",
    };
  });
}

function projectStatusFromReviews(reviews: AnyRow[]): AnyRow[] {
  return reviews.map((review) => ({
    project_id: Number(review.project_id),
    status: review.status === "final_confirmed" || review.status === "project_approved"
      ? "approved"
      : review.status === "needs_revision"
        ? "rejected"
        : review.status === "cancelled"
          ? "draft"
          : "pending",
    assignee_role: review.route_source || "",
    result_action: review.status || "",
    completed_at: review.project_approved_at || review.final_confirmed_at || review.last_action_at || "",
  }));
}

function approvedProjectIds(tasks: AnyRow[]): Set<number> {
  return new Set(
    tasks
      .filter(
        (task) =>
          task.scope_type === "project" &&
          task.status === "completed" &&
          task.result_action === "approve" &&
          task.scope_id,
      )
      .map((task) => Number(task.scope_id)),
  );
}

function reviewedTaskKey(task: AnyRow): string {
  const timesheetId = Number(task.target_id);
  return `timesheet:${timesheetId}`;
}

function latestReviewedTasks(tasks: AnyRow[]): AnyRow[] {
  const latest = new Map<string, AnyRow>();
  for (const task of tasks) {
    const key = reviewedTaskKey(task);
    const current = latest.get(key);
    const currentTime = Date.parse(current?.completed_at || "") || 0;
    const nextTime = Date.parse(task.completed_at || "") || 0;
    if (
      !current ||
      nextTime > currentTime ||
      (nextTime === currentTime && Number(task.id || 0) > Number(current.id || 0))
    ) {
      latest.set(key, task);
    }
  }
  return Array.from(latest.values());
}

function latestPendingTasks(tasks: AnyRow[]): AnyRow[] {
  const latest = new Map<string, AnyRow>();
  for (const task of tasks) {
    const key = `${Number(task.target_id)}:${task.scope_type || "timesheet"}:${Number(task.scope_id || 0)}:${Number(task.assignee_user_id || 0)}`;
    const current = latest.get(key);
    const currentTime = Date.parse(current?.created_at || "") || 0;
    const nextTime = Date.parse(task.created_at || "") || 0;
    if (
      !current ||
      nextTime > currentTime ||
      (nextTime === currentTime && Number(task.id || 0) > Number(current.id || 0))
    ) {
      latest.set(key, task);
    }
  }
  return Array.from(latest.values());
}

function isReportableTimesheet(sheet?: AnyRow | null): sheet is AnyRow {
  return !!sheet && REPORTABLE_TIMESHEET_STATUSES.has(String(sheet.status || ""));
}

function inferProjectBusinessType(code?: string | null): "PM" | "CC" | "PMCC" | null {
  const normalized = String(code || "").trim().toUpperCase();
  if (normalized.startsWith("PMCC")) return "PMCC";
  if (normalized.startsWith("PM")) return "PM";
  if (normalized.startsWith("CC")) return "CC";
  return null;
}

function employeeDailyRate(emp?: AnyRow | null): number {
  if (!emp) return 0;
  if (emp.contract_type === "service") return Number(emp.daily_wage || 0);
  const workdays = Number(emp.standard_monthly_workdays || 21.75);
  return Number(emp.monthly_salary || 0) / (workdays || 21.75);
}

async function nextId(table: string): Promise<number> {
  const rows = await rest<AnyRow[]>(`/${table}?select=id&order=id.desc&limit=1`);
  return Number(rows[0]?.id || 0) + 1;
}

async function currentUser(): Promise<AnyRow | null> {
  const sub = decodeJwt()?.sub;
  if (!sub) return null;
  const rows = await rest<AnyRow[]>(
    `/employees?select=id,name,is_active&auth_user_id=eq.${encodeURIComponent(sub)}&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;
  const roles = await rest<AnyRow[]>(`/user_roles?select=role&employee_id=eq.${row.id}&limit=1`);
  let department: string;
  try {
    const profiles = await rest<AnyRow[]>(`/employee_profiles_v2?select=org_id&employee_id=eq.${row.id}&limit=1`);
    const profile = profiles[0];
    const orgRows = profile?.org_id
      ? await rest<AnyRow[]>(`/organizations?select=org_name&id=eq.${profile.org_id}&limit=1`)
      : [];
    department = orgRows[0]?.org_name || "";
  } catch {
    department = "";
  }
  const roleRow = roles[0];
  return {
    id: Number(row.id),
    name: row.name,
    role: roleRow?.role || "employee",
    department,
    is_active: row.is_active ? 1 : 0,
  };
}

async function isAdmin(): Promise<boolean> {
  const user = await currentUser();
  return user?.role === "admin" || user?.name === "admin";
}

async function listEmployees(): Promise<AnyRow[]> {
  const [rows, rolesRows] = await Promise.all([
    rest<AnyRow[]>(
      "/hr_employee_current_view?select=*&is_active=eq.true&order=employee_id.asc",
    ),
    rest<AnyRow[]>("/user_roles?select=employee_id,role"),
  ]);
  const roleMap = new Map<number, string>();
  for (const r of rolesRows) roleMap.set(Number(r.employee_id), r.role);
  return rows
    .map((row) => {
    const eid = Number(row.employee_id);
    return {
    id: eid,
    name: row.employee_name,
    role: roleMap.get(eid) || "employee",
    employee_no: row.employee_no,
    org_id: row.org_id,
    org_name: row.org_name || "",
    department: row.org_name || "",
    position_name: row.position_name || "",
    contract_type: row.contract_type || "labor",
    monthly_salary: row.monthly_salary || "0",
    daily_wage: row.daily_wage || "0",
    hire_date: row.hire_date || "",
    contract_start: row.contract_start || "",
    contract_end: row.contract_end || "",
    manager_user_id: row.manager_user_id,
    manager_name: null,
    employment_type: row.employment_type || "labor",
    is_active: row.is_active,
    status: String(row.employment_status || "active").toLowerCase(),
    standard_monthly_workdays: Number(row.standard_monthly_workdays || 21.75),
    };
  })
    .filter((row) => row.is_active !== false && row.status !== "terminated");
}

async function organizations(): Promise<AnyRow[]> {
  const [orgs, employees] = await Promise.all([
    rest<AnyRow[]>("/organizations?select=*&status=eq.active&order=parent_id.asc,id.asc"),
    rest<AnyRow[]>("/employees?select=id,name"),
  ]);
  const names = new Map(employees.map((e) => [Number(e.id), e.name]));
  return orgs.map((org) => ({
    ...org,
    manager_name: org.manager_user_id ? names.get(Number(org.manager_user_id)) || null : null,
  }));
}

async function projects(): Promise<AnyRow[]> {
  const [rows, orgs, employees, labor, sheets, departmentOwners, projectRoles] = await Promise.all([
    rest<AnyRow[]>("/projects?select=*&status=neq.deleted&order=code.asc"),
    rest<AnyRow[]>("/organizations?select=id,org_name"),
    rest<AnyRow[]>("/employees?select=id,name"),
    rest<AnyRow[]>("/timesheet_entries?select=id,project_id,timesheet_id,hours"),
    rest<AnyRow[]>("/timesheets?select=id,status"),
    rest<AnyRow[]>("/project_department_owners?select=*&is_active=eq.true&order=project_id.asc,org_id.asc")
      .catch(() => []),
    rest<AnyRow[]>("/project_roles?select=*&status=eq.active&order=project_id.asc,role_key.asc")
      .catch(() => []),
  ]);
  const orgNames = new Map(orgs.map((o) => [Number(o.id), o.org_name]));
  const employeeNames = new Map(employees.map((e) => [Number(e.id), e.name]));
  const ownerRowsByProject = new Map<number, AnyRow[]>();
  for (const owner of departmentOwners) {
    const projectId = Number(owner.project_id);
    if (!ownerRowsByProject.has(projectId)) ownerRowsByProject.set(projectId, []);
    ownerRowsByProject.get(projectId)!.push({
      ...owner,
      id: Number(owner.id),
      project_id: projectId,
      org_id: Number(owner.org_id),
      org_name: orgNames.get(Number(owner.org_id)) || "",
      project_owner_id: Number(owner.project_owner_id),
      project_owner_name: employeeNames.get(Number(owner.project_owner_id)) || "",
      is_active: owner.is_active !== false,
    });
  }
  const roleRowsByProject = new Map<number, AnyRow[]>();
  for (const role of projectRoles) {
    const projectId = Number(role.project_id);
    if (!roleRowsByProject.has(projectId)) roleRowsByProject.set(projectId, []);
    roleRowsByProject.get(projectId)!.push({
      ...role,
      id: Number(role.id),
      project_id: projectId,
      user_id: Number(role.user_id),
      employee_id: Number(role.employee_id || role.user_id),
      user_name: employeeNames.get(Number(role.user_id)) || "",
      status: role.status || "active",
    });
  }
  const sheetMap = new Map(sheets.map((sheet) => [Number(sheet.id), sheet]));
  const hours = new Map<number, number>();
  const seenEntryIds = new Set<number>();
  for (const item of labor) {
    const entryId = Number(item.id);
    if (entryId && seenEntryIds.has(entryId)) continue;
    if (entryId) seenEntryIds.add(entryId);
    if (!isReportableTimesheet(sheetMap.get(Number(item.timesheet_id)))) continue;
    const projectId = Number(item.project_id);
    hours.set(projectId, (hours.get(projectId) || 0) + Number(item.hours || 0));
  }
  return rows.map((project) => {
    const contract = Number(project.contract_amount || 0);
    const received = Number(project.received_amount || 0);
    return {
      ...project,
      business_type: project.business_type || inferProjectBusinessType(project.code),
      contract_amount: contract,
      received_amount: received,
      receivable_amount: Number(project.receivable_amount ?? Math.max(contract - received, 0)),
      owner_org_name: project.owner_org_id ? orgNames.get(Number(project.owner_org_id)) || null : null,
      project_owner_name: project.project_owner_id ? employeeNames.get(Number(project.project_owner_id)) || null : null,
      department_owners: ownerRowsByProject.get(Number(project.id)) || [],
      project_roles: roleRowsByProject.get(Number(project.id)) || [],
      total_labor_hours: hours.get(Number(project.id)) || 0,
      total_labor_cost: 0,
    };
  });
}

async function getTimesheet(weekStart: string): Promise<AnyRow> {
  const user = await currentUser();
  if (!user) throw new Error("Not authenticated");
  let sheet = (await rest<AnyRow[]>(
    `/timesheets?select=*&user_id=eq.${user.id}&week_start_date=eq.${weekStart}&limit=1`,
  ))[0];
  if (!sheet) {
    const id = await nextId("timesheets");
    sheet = (await rest<AnyRow[]>("/timesheets", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{ id, user_id: user.id, week_start_date: weekStart }]),
    }))[0];
  }
  const [entries, overtime, tasks, reviews] = await Promise.all([
    rest<AnyRow[]>(
      `/timesheet_entries?select=*,projects(code,name)&timesheet_id=eq.${sheet.id}&order=project_id.asc,work_date.asc`,
    ),
    rest<AnyRow[]>(`/overtime_entries?select=*&timesheet_id=eq.${sheet.id}&order=work_date.asc`),
    rest<AnyRow[]>(`/workflow_tasks?select=*&workflow_key=eq.timesheet&target_type=eq.timesheet&target_id=eq.${sheet.id}`),
    rest<AnyRow[]>(`/approval_project_review_records_view?select=*&timesheet_id=eq.${sheet.id}&order=project_id.asc,last_action_at.desc`)
      .catch(() => rest<AnyRow[]>(`/timesheet_project_reviews?select=*&timesheet_id=eq.${sheet.id}&order=project_id.asc,round_no.desc`))
      .catch(() => []),
  ]);
  const taskProjectStatuses = reviews.length ? projectStatusFromReviews(reviews) : projectStatusFromTasks(sheet, tasks);
  const taskProjectIds = new Set(taskProjectStatuses.map((item) => Number(item.project_id)));
  const entryProjectIds = [...new Set(entries.map((entry) => Number(entry.project_id)).filter(Boolean))];
  return {
    ...sheet,
    days: weekDays(weekStart),
    entries: entries.map((entry) => ({
      ...entry,
      project_code: entry.projects?.code,
      project_name: entry.projects?.name,
      hours: Number(entry.hours || 0),
    })),
    overtime: overtime.map((entry) => ({
      ...entry,
      overtime_hours: Number(entry.overtime_hours || 0),
    })),
    project_statuses: [
      ...taskProjectStatuses,
      ...entryProjectIds
        .filter((projectId) => !taskProjectIds.has(projectId))
        .map((projectId) => ({ project_id: projectId, status: sheet.status === "submitted" ? "pending" : "draft" })),
    ],
  };
}

async function getTimesheetDetail(timesheetId: number): Promise<AnyRow> {
  if (!timesheetId) throw new Error("Timesheet id is required");
  const sheet = (await rest<AnyRow[]>(
    `/timesheets?select=*&id=eq.${timesheetId}&limit=1`,
  ))[0];
  if (!sheet) throw new Error("Timesheet not found");
  const [entries, overtime, userRows, profRows, tasks, reviews] = await Promise.all([
    rest<AnyRow[]>(
      `/timesheet_entries?select=*,projects(code,name)&timesheet_id=eq.${sheet.id}&order=project_id.asc,work_date.asc`,
    ),
    rest<AnyRow[]>(`/overtime_entries?select=*&timesheet_id=eq.${sheet.id}&order=work_date.asc`),
    rest<AnyRow[]>(`/employees?select=name&id=eq.${sheet.user_id}&limit=1`),
    rest<AnyRow[]>(`/employee_profiles_v2?select=organizations(org_name)&employee_id=eq.${sheet.user_id}&limit=1`),
    rest<AnyRow[]>(`/workflow_tasks?select=*&workflow_key=eq.timesheet&target_type=eq.timesheet&target_id=eq.${sheet.id}`),
    rest<AnyRow[]>(`/approval_project_review_records_view?select=*&timesheet_id=eq.${sheet.id}&order=project_id.asc,last_action_at.desc`)
      .catch(() => rest<AnyRow[]>(`/timesheet_project_reviews?select=*&timesheet_id=eq.${sheet.id}&order=project_id.asc,round_no.desc`))
      .catch(() => []),
  ]);
  const userName = userRows[0]?.name || "";
  const profile = profRows[0];
  return {
    id: Number(sheet.id),
    user_name: userName,
    department: profile?.organizations?.org_name || "",
    week_start_date: sheet.week_start_date,
    status: sheet.status,
    remark: sheet.remark || "",
    days: weekDays(sheet.week_start_date),
    entries: entries.map((entry) => ({
      project_id: Number(entry.project_id),
      project_code: entry.projects?.code || "",
      project_name: entry.projects?.name || "",
      work_date: entry.work_date,
      hours: Number(entry.hours || 0),
      description: entry.description || "",
    })),
    overtime: overtime.map((entry) => ({
      work_date: entry.work_date,
      overtime_hours: Number(entry.overtime_hours || 0),
      reason: entry.reason || "",
      status: entry.status || "",
    })),
    project_statuses: reviews.length ? projectStatusFromReviews(reviews) : projectStatusFromTasks(sheet, tasks),
  };
}

async function saveTimesheet(body: AnyRow): Promise<AnyRow> {
  const sheet = await getTimesheet(body.weekStart);
  if (!["draft", "rejected", "revision_required"].includes(sheet.status)) {
    throw new Error("Submitted or approved timesheets cannot be edited");
  }
  const existingEntries = await rest<AnyRow[]>(
    `/timesheet_entries?select=*&timesheet_id=eq.${sheet.id}&order=project_id.asc,work_date.asc`,
  );
  const [existingTasks, graphReviews] = await Promise.all([
    rest<AnyRow[]>(
      `/workflow_tasks?select=*&workflow_key=eq.timesheet&target_type=eq.timesheet&target_id=eq.${sheet.id}`,
    ),
    rest<AnyRow[]>(`/approval_project_review_records_view?select=project_id,status,result_action&timesheet_id=eq.${sheet.id}`)
      .catch(() => []),
  ]);
  const lockedProjectIds = new Set([
    ...approvedProjectIds(existingTasks),
    ...graphReviews
      .filter((review) => review.status === "project_approved" || review.result_action === "approve")
      .map((review) => Number(review.project_id)),
  ]);
  await rest(`/timesheets?id=eq.${sheet.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ remark: body.remark || "", updated_at: new Date().toISOString() }),
  });
  if (lockedProjectIds.size > 0) {
    await rest(
      `/timesheet_entries?timesheet_id=eq.${sheet.id}&project_id=not.in.(${Array.from(lockedProjectIds).join(",")})`,
      { method: "DELETE" },
    );
  } else {
    await rest(`/timesheet_entries?timesheet_id=eq.${sheet.id}`, { method: "DELETE" });
  }
  const mergedEntries = new Map<string, AnyRow>();
  for (const entry of body.entries || []) {
    const hours = Number(entry.hours || 0);
    if (hours <= 0) continue;
    if (lockedProjectIds.has(Number(entry.projectId))) continue;
    const key = `${entry.projectId}:${entry.workDate}`;
    const current = mergedEntries.get(key);
    if (current) {
      current.hours = Number(current.hours || 0) + hours;
      current.description = [current.description, entry.description].filter(Boolean).join("\n");
    } else {
      mergedEntries.set(key, { ...entry, hours });
    }
  }
  const entries = Array.from(mergedEntries.values())
    .map((entry: AnyRow, index: number) => ({
      id: Date.now() + index,
      timesheet_id: sheet.id,
      project_id: entry.projectId,
      work_date: entry.workDate,
      hours: entry.hours,
      description: entry.description || "",
    }));
  const preservedEntries = existingEntries.filter((entry) =>
    lockedProjectIds.has(Number(entry.project_id)),
  );
  assertTimesheetHoursWithinLimits([...preservedEntries, ...entries]);
  if (entries.length) {
    await rest("/timesheet_entries", { method: "POST", body: JSON.stringify(entries) });
  }
  const preservedProjects = new Set(existingEntries.map((entry) => Number(entry.project_id)));
  for (const projectId of lockedProjectIds) {
    if (!preservedProjects.has(projectId)) {
      throw new Error(`Approved project row ${projectId} cannot be removed`);
    }
  }
  await rest(`/overtime_entries?timesheet_id=eq.${sheet.id}`, { method: "DELETE" });
  const overtime = (body.overtime || [])
    .filter((entry: AnyRow) => Number(entry.hours || 0) > 0 || entry.reason)
    .map((entry: AnyRow, index: number) => ({
      id: Date.now() + 1000 + index,
      timesheet_id: sheet.id,
      work_date: entry.workDate,
      overtime_hours: Number(entry.hours || 0),
      reason: entry.reason || "",
      status: "pending",
    }));
  if (overtime.length) {
    await rest("/overtime_entries", { method: "POST", body: JSON.stringify(overtime) });
  }
  return { ok: true, timesheet: await getTimesheet(body.weekStart) };
}

async function timesheetAction(body: AnyRow): Promise<AnyRow> {
  if (!body.timesheetId) throw new Error("Timesheet id is required");
  return rest<AnyRow>("/rpc/psa_timesheet_action", {
    method: "POST",
    body: JSON.stringify({
      p_timesheet_id: Number(body.timesheetId),
      p_action: body.action,
      p_comment: body.comment || "",
      p_task_id: body.taskId ? Number(body.taskId) : null,
    }),
  });
}

async function approvalTasks(_weekStart: string): Promise<AnyRow> {
  const user = await currentUser();
  if (!user) throw new Error("Not authenticated");
  const admin = await isAdmin();
  const taskFilter = admin ? "" : `&assignee_user_id=eq.${user.id}`;
  const reviewedTaskFilter = admin ? "" : `&assignee_user_id=eq.${user.id}`;
  // Fetch ALL pending tasks (not filtered by week — approval center shows everything)
  // Flat queries — avoid PostgREST embedded resources that need missing FKs
  const [tasks, reviewedTasks, employees, employeeProfiles, entries] = await Promise.all([
    rest<AnyRow[]>(`/approval_pending_tasks_view?select=*&target_type=eq.timesheet${taskFilter}`)
      .catch(() => rest<AnyRow[]>(`/workflow_tasks?select=*&workflow_key=eq.timesheet&target_type=eq.timesheet&status=eq.pending${taskFilter}`)),
    rest<AnyRow[]>(`/approval_reviewed_timesheets_view?select=*&target_type=eq.timesheet&result_action=in.(approve,reject)${reviewedTaskFilter}`)
      .catch(() => rest<AnyRow[]>(`/workflow_tasks?select=*&workflow_key=eq.timesheet&target_type=eq.timesheet&status=eq.completed&result_action=in.(approve,reject)${admin ? "" : `&or=(completed_by.eq.${user.id},assignee_user_id.eq.${user.id})`}`)),
    rest<AnyRow[]>("/employees?select=id,name"),
    rest<AnyRow[]>("/employee_profiles_v2?select=employee_id,organizations(org_name)"),
    rest<AnyRow[]>("/timesheet_entries?select=timesheet_id,project_id,hours"),
  ]);
  const latestPending = latestPendingTasks(tasks);
  const latestReviewed = latestReviewedTasks(reviewedTasks);

  // Fetch ALL timesheets referenced by tasks (not filtered by week)
  const pendingSheetIds = [...new Set(latestPending.map((t: AnyRow) => Number(t.target_id)))].filter(Boolean);
  const reviewedSheetIds = [...new Set(latestReviewed.map((t: AnyRow) => Number(t.target_id)))].filter(Boolean);
  const allSheetIds = [...new Set([...pendingSheetIds, ...reviewedSheetIds])];
  const sheets = allSheetIds.length > 0
    ? await rest<AnyRow[]>(`/timesheets?select=*&id=in.(${allSheetIds.join(",")})`)
    : [];

  // Fetch overtime entries for ALL pending ones (not filtered by week)
  const overtimeRowsRaw = await rest<AnyRow[]>("/overtime_entries?select=*&status=eq.pending");
  const otSheetIds = [...new Set(overtimeRowsRaw.map((o: AnyRow) => Number(o.timesheet_id)))].filter(Boolean);
  const otSheets = otSheetIds.length > 0
    ? await rest<AnyRow[]>(`/timesheets?select=id,status,week_start_date,user_id&id=in.(${otSheetIds.join(",")})`)
    : [];
  const otSheetMap = new Map(otSheets.map((s: AnyRow) => [Number(s.id), s]));
  const otUserIds = [...new Set(otSheets.map((s: AnyRow) => Number(s.user_id)))].filter(Boolean);
  const otUsers = otUserIds.length > 0
    ? await rest<AnyRow[]>(`/employees?select=id,name&id=in.(${otUserIds.join(",")})`)
    : [];
  const otUserMap = new Map(otUsers.map((u: AnyRow) => [Number(u.id), u]));
  const overtimeRows: AnyRow[] = overtimeRowsRaw.map((o: AnyRow) => {
    const ts = otSheetMap.get(Number(o.timesheet_id));
    const u = ts ? otUserMap.get(Number(ts.user_id)) : null;
    return { ...o, timesheets: ts ? { ...ts, employees: u ? { name: u.name } : null, week_start_date: ts.week_start_date } : null };
  });
  const employeeMap = new Map(employees.map((e) => [Number(e.id), e]));
  const employeeProfileMap = new Map(employeeProfiles.map((profile) => [Number(profile.employee_id), profile]));
  const hours = new Map<number, number>();
  const projectHours = new Map<string, number>();
  for (const entry of entries) hours.set(Number(entry.timesheet_id), (hours.get(Number(entry.timesheet_id)) || 0) + Number(entry.hours || 0));
  for (const entry of entries) {
    const key = `${Number(entry.timesheet_id)}:${Number(entry.project_id)}`;
    projectHours.set(key, (projectHours.get(key) || 0) + Number(entry.hours || 0));
  }
  const sheetMap = new Map(sheets.map((s) => [Number(s.id), s]));
  const projectIds = [
    ...new Set(
      [...latestPending, ...latestReviewed]
        .filter((task) => task.scope_type === "project" && task.scope_id)
        .map((task) => Number(task.scope_id)),
    ),
  ];
  const projectRows = projectIds.length
    ? await rest<AnyRow[]>(`/projects?select=id,code,name&id=in.(${projectIds.join(",")})`)
    : [];
  const projectMap = new Map(projectRows.map((project) => [Number(project.id), project]));
  const toItem = (sheet: AnyRow, source: AnyRow) => {
    const emp = employeeMap.get(Number(sheet.user_id));
    const profile = employeeProfileMap.get(Number(sheet.user_id));
    const projectId = source.scope_type === "project" ? Number(source.scope_id) : null;
    const project = projectId ? projectMap.get(projectId) : null;
    return {
      task_id: source.id ? Number(source.id) : undefined,
      timesheet_id: Number(sheet.id),
      user_id: Number(sheet.user_id),
      week_start_date: sheet.week_start_date,
      status: source.result_action === "reject" ? "rejected" : sheet.status,
      assignee_role: source.assignee_role || "",
      scope_type: source.scope_type || "timesheet",
      scope_id: source.scope_id ? Number(source.scope_id) : null,
      project_id: projectId,
      project_code: project?.code || "",
      project_name: project?.name || "",
      name: emp?.name || "",
      department: profile?.organizations?.org_name || "",
      total_hours: projectId ? projectHours.get(`${Number(sheet.id)}:${projectId}`) || 0 : hours.get(Number(sheet.id)) || 0,
      submitted_at: sheet.submitted_at,
      review_comment: source.comment || sheet.review_comment || "",
    };
  };
  const pending = latestPending
    .map((task) => ({ task, sheet: sheetMap.get(Number(task.target_id)) }))
    .filter((item): item is { task: AnyRow; sheet: AnyRow } => !!item.sheet && item.sheet.status === "submitted")
    .sort((a, b) => (a.task.created_at || "").localeCompare(b.task.created_at || ""))
    .map(({ task, sheet }) => toItem(sheet, task));
  const reviewed = latestReviewed
    .map((task) => ({ task, sheet: sheetMap.get(Number(task.target_id)) }))
    .filter((item): item is { task: AnyRow; sheet: AnyRow } => !!item.sheet)
    .sort((a, b) => (b.task.completed_at || "").localeCompare(a.task.completed_at || ""))
    .map(({ task, sheet }) => toItem(sheet, task));
  const overtime = overtimeRows
    .filter((o) => o.status === "pending" && Number(o.overtime_hours || 0) > 0)
    .map((o) => ({
      id: Number(o.id),
      user_name: o.timesheets?.employees?.name || "",
      work_date: o.work_date,
      overtime_hours: Number(o.overtime_hours || 0),
      reason: o.reason || "",
      status: o.status,
      reject_comment: o.reject_comment || "",
    }));
  const overtimeReviewed = overtimeRows
    .filter((o) => ["approved", "rejected"].includes(o.status))
    .map((o) => ({
      id: Number(o.id),
      user_name: o.timesheets?.employees?.name || "",
      work_date: o.work_date,
      overtime_hours: Number(o.overtime_hours || 0),
      reason: o.reason || "",
      status: o.status,
      reject_comment: o.reject_comment || "",
    }));
  return { timesheets: pending, reviewed, overtime, overtimeReviewed };
}

async function weeklyReport(startDate: string, endDate: string): Promise<AnyRow> {
  const [entries, projectsData, sheets, employees] = await Promise.all([
    rest<AnyRow[]>(`/timesheet_entries?select=id,project_id,timesheet_id,work_date,hours&work_date=gte.${startDate}&work_date=lte.${endDate}`),
    rest<AnyRow[]>("/projects?select=id,code,name"),
    rest<AnyRow[]>("/timesheets?select=id,user_id,status"),
    rest<AnyRow[]>("/employees?select=id,name"),
  ]);
  const projectMap = new Map(projectsData.map((p) => [Number(p.id), p]));
  const sheetMap = new Map(sheets.map((s) => [Number(s.id), s]));
  const employeeMap = new Map(employees.map((e) => [Number(e.id), e]));
  const projectHours = new Map<number, { total: number; people: Set<number> }>();
  const employeeHours = new Map<number, number>();
  const seenEntryIds = new Set<number>();
  for (const entry of entries) {
    const entryId = Number(entry.id);
    if (entryId && seenEntryIds.has(entryId)) continue;
    if (entryId) seenEntryIds.add(entryId);
    const sheet = sheetMap.get(Number(entry.timesheet_id));
    if (!isReportableTimesheet(sheet)) continue;
    const sheetUserId = Number(sheet.user_id);
    const projectId = Number(entry.project_id);
    if (!projectHours.has(projectId)) projectHours.set(projectId, { total: 0, people: new Set() });
    const row = projectHours.get(projectId)!;
    row.total += Number(entry.hours || 0);
    row.people.add(sheetUserId);
    employeeHours.set(sheetUserId, (employeeHours.get(sheetUserId) || 0) + Number(entry.hours || 0));
  }
  return {
    startDate,
    endDate,
    projects: Array.from(projectHours.entries()).map(([id, value]) => ({
      id,
      code: projectMap.get(id)?.code || "",
      name: projectMap.get(id)?.name || "",
      people_count: value.people.size,
      total_hours: value.total,
    })),
    employees: Array.from(employeeHours.entries()).map(([id, value]) => ({
      id,
      name: employeeMap.get(id)?.name || "",
      total_hours: value,
    })),
  };
}

async function projectDetail(projectId: string, startDate: string, endDate: string): Promise<AnyRow[]> {
  // Flat query — avoid embedded timesheets(employees(...)) which needs missing FK
  const [entries, allSheets, allUsers, allProfs] = await Promise.all([
    rest<AnyRow[]>(`/timesheet_entries?select=id,timesheet_id,work_date,hours&project_id=eq.${projectId}&work_date=gte.${startDate}&work_date=lte.${endDate}`),
    rest<AnyRow[]>("/timesheets?select=id,user_id,status"),
    rest<AnyRow[]>("/employees?select=id,name"),
    rest<AnyRow[]>("/employee_profiles_v2?select=employee_id,organizations(org_name)"),
  ]);
  const sheetMap = new Map(allSheets.map((s: AnyRow) => [Number(s.id), s]));
  const userMap = new Map(allUsers.map((u: AnyRow) => [Number(u.id), u]));
  const profMap = new Map(allProfs.map((p: AnyRow) => [Number(p.employee_id), p]));

  const byUser = new Map<number, { name: string; department: string; total: number; days: Set<string> }>();
  const seenEntryIds = new Set<number>();
  for (const entry of entries) {
    const entryId = Number(entry.id);
    if (entryId && seenEntryIds.has(entryId)) continue;
    if (entryId) seenEntryIds.add(entryId);
    const sheet = sheetMap.get(Number(entry.timesheet_id));
    if (!isReportableTimesheet(sheet)) continue;
    const userId = Number(sheet.user_id);
    const user = userMap.get(userId);
    const prof = profMap.get(userId);
    if (!byUser.has(userId)) byUser.set(userId, { name: user?.name || "", department: prof?.organizations?.org_name || "", total: 0, days: new Set() });
    const row = byUser.get(userId)!;
    row.total += Number(entry.hours || 0);
    row.days.add(entry.work_date);
  }
  return Array.from(byUser.values()).map((row) => ({ name: row.name, department: row.department, total_hours: row.total, work_days: row.days.size }));
}

async function laborMatrix(startDate: string, endDate: string): Promise<AnyRow[]> {
  const [entries, sheets, projectRows, employees] = await Promise.all([
    rest<AnyRow[]>(`/timesheet_entries?select=id,project_id,timesheet_id,work_date,hours&work_date=gte.${startDate}&work_date=lte.${endDate}`),
    rest<AnyRow[]>("/timesheets?select=id,user_id,status"),
    rest<AnyRow[]>("/projects?select=id,code,name,status&status=neq.deleted"),
    listEmployees(),
  ]);
  const sheetMap = new Map(sheets.map((sheet) => [Number(sheet.id), sheet]));
  const projectMap = new Map(projectRows.map((project) => [Number(project.id), project]));
  const employeeMap = new Map(employees.map((employee) => [Number(employee.id), employee]));
  const seenEntryIds = new Set<number>();
  const byEmployeeProject = new Map<
    string,
    {
      employeeId: number;
      projectId: number;
      total: number;
      days: Set<string>;
    }
  >();

  for (const entry of entries) {
    const entryId = Number(entry.id);
    if (entryId && seenEntryIds.has(entryId)) continue;
    if (entryId) seenEntryIds.add(entryId);
    const sheet = sheetMap.get(Number(entry.timesheet_id));
    if (!isReportableTimesheet(sheet)) continue;
    const employeeId = Number(sheet.user_id);
    const projectId = Number(entry.project_id);
    const key = `${employeeId}:${projectId}`;
    if (!byEmployeeProject.has(key)) {
      byEmployeeProject.set(key, {
        employeeId,
        projectId,
        total: 0,
        days: new Set<string>(),
      });
    }
    const row = byEmployeeProject.get(key)!;
    row.total += Number(entry.hours || 0);
    if (entry.work_date) row.days.add(entry.work_date);
  }

  return Array.from(byEmployeeProject.values())
    .map((row) => {
      const employee = employeeMap.get(row.employeeId);
      const project = projectMap.get(row.projectId);
      const dailyRate = employeeDailyRate(employee);
      return {
        employee_id: row.employeeId,
        employee_name: employee?.name || "",
        department: employee?.org_name || employee?.department || "未分配部门",
        project_id: row.projectId,
        project_code: project?.code || "",
        project_name: project?.name || "",
        total_hours: row.total,
        work_days: row.days.size,
        daily_rate: dailyRate,
        labor_cost: Math.round(row.total * dailyRate),
      };
    })
    .filter((row) => row.employee_name && row.project_name);
}

async function saveProjectDepartmentOwners(projectId: number, owners: AnyRow[] = []): Promise<void> {
  const current = await rest<AnyRow[]>(
    `/project_department_owners?select=*&project_id=eq.${projectId}&is_active=eq.true`,
  ).catch(() => []);
  const activeIds = new Set<number>();
  const seen = new Set<string>();

  for (const item of owners) {
    const orgId = Number(item.org_id || item.orgId || 0);
    const ownerId = Number(item.project_owner_id || item.projectOwnerId || 0);
    if (!orgId || !ownerId) continue;
    const roleKey = item.role_key || item.roleKey || "project_owner";
    const key = `${orgId}:${roleKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = {
      project_id: projectId,
      org_id: orgId,
      project_owner_id: ownerId,
      role_key: roleKey,
      is_active: true,
    };
    const existing = item.id
      ? current.find((owner) => Number(owner.id) === Number(item.id))
      : current.find((owner) => Number(owner.org_id) === orgId && String(owner.role_key || "project_owner") === roleKey);
    if (existing?.id) {
      activeIds.add(Number(existing.id));
      await rest(`/project_department_owners?id=eq.${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify(row),
      });
    } else {
      const inserted = await rest<AnyRow[]>("/project_department_owners", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([row]),
      });
      if (inserted[0]?.id) activeIds.add(Number(inserted[0].id));
    }
  }

  const deactivateIds = current
    .map((owner) => Number(owner.id))
    .filter((id) => id && !activeIds.has(id));
  if (deactivateIds.length) {
    await rest(`/project_department_owners?id=in.(${deactivateIds.join(",")})`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: false }),
    });
  }
}

async function saveProjectRoles(projectId: number, roles: AnyRow[] = []): Promise<void> {
  const roleKeys = [
    "cc_project_owner",
    "cc_department_owner",
    "pm_cost_department_owner",
    "pm_project_owner",
    "pm_department_owner",
  ];
  const current = await rest<AnyRow[]>(
    `/project_roles?select=*&project_id=eq.${projectId}&role_key=in.(${roleKeys.join(",")})&status=eq.active`,
  ).catch(() => []);
  const activeIds = new Set<number>();
  const seen = new Set<string>();
  const employeeOrgMap = new Map<number, number | null>();

  for (const role of roles) {
    const roleKey = String(role.role_key || role.roleKey || "");
    const userId = Number(role.user_id || role.userId || role.employee_id || role.employeeId || 0);
    if (!roleKeys.includes(roleKey) || !userId || seen.has(roleKey)) continue;
    seen.add(roleKey);
    if (!employeeOrgMap.has(userId)) {
      const profile = (await rest<AnyRow[]>(
        `/employee_profiles_v2?select=org_id&employee_id=eq.${userId}&limit=1`,
      ).catch(() => []))[0];
      employeeOrgMap.set(userId, profile?.org_id ? Number(profile.org_id) : null);
    }
    const row = {
      project_id: projectId,
      role_key: roleKey,
      employee_id: userId,
      user_id: userId,
      org_id: employeeOrgMap.get(userId),
      status: "active",
    };
    const existing = current.find((item) => String(item.role_key) === roleKey);
    if (existing?.id) {
      activeIds.add(Number(existing.id));
      await rest(`/project_roles?id=eq.${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify(row),
      });
    } else {
      const inserted = await rest<AnyRow[]>("/project_roles", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([row]),
      });
      if (inserted[0]?.id) activeIds.add(Number(inserted[0].id));
    }
  }

  const deactivateIds = current
    .map((role) => Number(role.id))
    .filter((id) => id && !activeIds.has(id));
  if (deactivateIds.length) {
    await rest(`/project_roles?id=in.(${deactivateIds.join(",")})`, {
      method: "PATCH",
      body: JSON.stringify({ status: "inactive" }),
    });
  }
}

async function refreshProjectRoutes(projectId: number, reason: string): Promise<void> {
  await rest("/rpc/psa_refresh_pending_project_review_routes", {
    method: "POST",
    body: JSON.stringify({ p_project_id: projectId, p_reason: reason }),
  }).catch(() =>
    rest("/rpc/psa_refresh_project_timesheet_routes", {
      method: "POST",
      body: JSON.stringify({ p_project_id: projectId, p_reason: reason }),
    }),
  );
}

async function saveProject(body: AnyRow): Promise<AnyRow> {
  const projectId = body.id ? Number(body.id) : null;
  const existingProject = projectId
    ? await rest<AnyRow[]>(`/projects?select=id,project_owner_id&id=eq.${projectId}&limit=1`)
    : [];
  const row = {
    code: body.code,
    name: body.name,
    business_type: body.businessType || body.business_type || inferProjectBusinessType(body.code),
    contract_amount: Number(body.contractAmount || body.contract_amount || 0),
    received_amount: Number(body.receivedAmount || body.received_amount || 0),
    owner_org_id: body.ownerOrgId || body.owner_org_id || null,
    project_owner_id: body.projectOwnerId || body.project_owner_id || null,
    status: "active",
  };
  if (projectId) {
    await rest(`/projects?id=eq.${projectId}`, { method: "PATCH", body: JSON.stringify(row) });
    const previousOwnerId = existingProject[0]?.project_owner_id ? Number(existingProject[0].project_owner_id) : null;
    const nextOwnerId = row.project_owner_id ? Number(row.project_owner_id) : null;
    await saveProjectDepartmentOwners(projectId, body.departmentOwners || body.department_owners || []);
    await saveProjectRoles(projectId, body.projectRoles || body.project_roles || []);
    if (previousOwnerId !== nextOwnerId || body.departmentOwners || body.department_owners || body.projectRoles || body.project_roles) {
      await refreshProjectRoutes(projectId, "Route refreshed after project owner change");
    }
  } else {
    // Check for duplicate project code before inserting
    const existing = await rest<AnyRow[]>(
      `/projects?select=id&code=eq.${encodeURIComponent(row.code)}&status=neq.deleted&limit=1`,
    );
    if (existing.length > 0) {
      throw new Error(`项目代码「${row.code}」已存在，请更换代码后重试`);
    }
    const newProjectId = await nextId("projects");
    await rest("/projects", { method: "POST", body: JSON.stringify([{ id: newProjectId, ...row }]) });
    await saveProjectDepartmentOwners(newProjectId, body.departmentOwners || body.department_owners || []);
    await saveProjectRoles(newProjectId, body.projectRoles || body.project_roles || []);
  }
  return { ok: true, projects: await projects() };
}

async function overtimeAction(body: AnyRow): Promise<AnyRow> {
  // Map frontend status ("approved"/"rejected") to RPC action ("approve"/"reject")
  const status = body.status;
  const action = status === "approved" ? "approve" : status === "rejected" ? "reject" : status;
  return rest<AnyRow>("/rpc/psa_overtime_action", {
    method: "POST",
    body: JSON.stringify({
      p_overtime_id: Number(body.id),
      p_action: action,
      p_comment: body.comment || "",
    }),
  });
}

async function saveOrganization(body: AnyRow): Promise<AnyRow> {
  const row = {
    org_name: body.orgName || body.org_name,
    org_type: body.orgType || body.org_type || "department",
    parent_id: body.parentId || body.parent_id || null,
    manager_user_id: body.managerUserId || body.manager_user_id || null,
    status: "active",
  };
  if (body.id) {
    await rest(`/organizations?id=eq.${body.id}`, { method: "PATCH", body: JSON.stringify(row) });
  } else {
    const id = await nextId("organizations");
    await rest("/organizations", { method: "POST", body: JSON.stringify([{ id, org_code: `D${String(id).padStart(3, "0")}`, ...row }]) });
  }
  return { ok: true, organizations: await organizations() };
}

async function saveEmployee(body: AnyRow): Promise<AnyRow> {
  const name = body.name || "";
  if (!name) throw new Error("Employee name is required");

  // New employee: single atomic endpoint
  if (!body.id) {
    const token = getStoredToken();
    const resp = await fetch("/api/create-employee-with-login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.message || "Failed to create employee");
    }
    // Return initial password to caller (UI can show it once)
    return {
      ok: true,
      employees: await listEmployees(),
      loginName: data.login_name,
      initialPassword: data.initial_password,
    };
  }

  // Edit existing employee: direct PostgREST writes
  const id = Number(body.id);
  const admin = await isAdmin();
  const contractType = body.contractType || body.contract_type || "labor";
  await rest(`/employees?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ name, employee_no: body.employeeNo || body.employee_no || `QS${String(id).padStart(6, "0")}`, is_active: (body.status || "active") !== "terminated" }) });
  await rest(`/employee_profiles_v2?employee_id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ org_id: body.orgId || body.org_id || null, position_name: body.positionName || body.position_name || "", employment_status: body.status || "active", manager_user_id: body.managerUserId || body.manager_user_id || null, hire_date: body.hireDate || body.hire_date || null }) });
  await rest(`/employee_contracts?employee_id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ is_current: false }) });
  await rest("/employee_contracts", { method: "POST", body: JSON.stringify([{ employee_id: id, contract_type: contractType, employment_type: body.employmentType || body.employment_type || "labor", is_current: true }]) });
  await rest(`/employee_salary_profiles?employee_id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ is_current: false }) });
  await rest("/employee_salary_profiles", { method: "POST", body: JSON.stringify([{ employee_id: id, salary_mode: contractType === "service" ? "daily_wage" : "monthly_salary", monthly_salary: contractType === "service" ? 0 : Number(body.monthlySalary || body.monthly_salary || 0), daily_wage: contractType === "service" ? Number(body.dailyWage || body.daily_wage || 0) : 0, is_current: true }]) });
  if (admin) {
    await rest(`/user_roles?employee_id=eq.${id}`, { method: "DELETE" });
    await rest("/user_roles", { method: "POST", body: JSON.stringify([{ employee_id: id, role: body.role || "employee" }]) });
  }
  return { ok: true, employees: await listEmployees() };
}

async function handleApi<T>(path: string, options: RequestInit): Promise<T> {
  const url = new URL(path, window.location.origin);
  const body = payload(options);
  if (url.pathname === "/api/login") {
    const resp = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login: body.login, password: body.password }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      throw new Error(data.message || "Invalid login credentials");
    }
    setStoredToken(data.token);
    return { ok: true, token: data.token } as T;
  }
  if (url.pathname === "/api/logout") {
    clearStoredToken();
    return { ok: true } as T;
  }
  if (url.pathname === "/api/password/change") {
    const token = getStoredToken();
    const resp = await fetch("/api/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        login: body.login,
        oldPassword: body.oldPassword,
        newPassword: body.newPassword,
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.message || "Password change failed");
    return { ok: true } as T;
  }
  if (url.pathname === "/api/me") return { user: await currentUser() } as T;
  if (url.pathname === "/api/bootstrap") {
    const user = await currentUser();
    const projectRows = user ? await projects().catch(() => []) : [];
    return { currentUser: user, users: [], projects: projectRows, currentWeek: todayMonday(), dbRecommendation: "Supabase PostgREST" } as T;
  }
  if (url.pathname === "/api/organizations") return organizations() as T;
  if (url.pathname === "/api/employees") return listEmployees() as T;
  if (url.pathname === "/api/projects") return projects() as T;
  if (url.pathname === "/api/timesheet") return getTimesheet(url.searchParams.get("weekStart") || todayMonday()) as T;
  if (url.pathname === "/api/timesheet-detail") return getTimesheetDetail(Number(url.searchParams.get("timesheetId") || 0)) as T;
  if (url.pathname === "/api/timesheet/save") return saveTimesheet(body) as T;
  if (url.pathname === "/api/timesheet/action") return timesheetAction(body) as T;
  if (url.pathname === "/api/approvals/tasks") return approvalTasks(url.searchParams.get("weekStart") || todayMonday()) as T;
  if (url.pathname === "/api/reports/weekly") {
    const startDate = url.searchParams.get("startDate") || url.searchParams.get("weekStart") || todayMonday();
    const endDate = url.searchParams.get("endDate") || weekDays(startDate)[6];
    return weeklyReport(startDate, endDate) as T;
  }
  if (url.pathname === "/api/reports/labor-matrix") {
    const startDate = url.searchParams.get("startDate") || url.searchParams.get("weekStart") || todayMonday();
    const endDate = url.searchParams.get("endDate") || weekDays(startDate)[6];
    return laborMatrix(startDate, endDate) as T;
  }
  if (url.pathname === "/api/project-detail") {
    return projectDetail(url.searchParams.get("projectId") || "0", url.searchParams.get("startDate") || todayMonday(), url.searchParams.get("endDate") || todayMonday()) as T;
  }
  if (url.pathname === "/api/projects/save") return saveProject(body) as T;
  if (url.pathname === "/api/project-department-owners/save") {
    await saveProjectDepartmentOwners(Number(body.projectId || body.project_id), body.departmentOwners || body.department_owners || []);
    return { ok: true, projects: await projects() } as T;
  }
  if (url.pathname === "/api/projects/delete") {
    await rest(`/projects?id=eq.${body.id}`, { method: "PATCH", body: JSON.stringify({ status: "deleted" }) });
    return { ok: true, projects: await projects() } as T;
  }
  if (url.pathname === "/api/organizations/save") return saveOrganization(body) as T;
  if (url.pathname === "/api/organizations/delete") {
    await rest(`/organizations?id=eq.${body.id}`, { method: "PATCH", body: JSON.stringify({ status: "deleted" }) });
    return { ok: true, organizations: await organizations() } as T;
  }
  if (url.pathname === "/api/employees/save") return saveEmployee(body) as T;
  if (url.pathname === "/api/employees/delete") {
    await rest(`/employees?id=eq.${body.id}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
    await rest(`/employee_profiles_v2?employee_id=eq.${body.id}`, { method: "PATCH", body: JSON.stringify({ employment_status: "terminated" }) });
    return { ok: true, employees: await listEmployees() } as T;
  }
  if (url.pathname === "/api/overtime/action") return overtimeAction(body) as T;
  if (url.pathname === "/api/overtime/pending") {
    const data = await approvalTasks(url.searchParams.get("weekStart") || todayMonday());
    return data.overtime as T;
  }
  throw new Error(`Unsupported Supabase API route: ${url.pathname}`);
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  return handleApi<T>(path, options);
}

export function getClientId(): string {
  return CLIENT_ID;
}
