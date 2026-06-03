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

function isReportableTimesheet(sheet?: AnyRow | null): sheet is AnyRow {
  return !!sheet && REPORTABLE_TIMESHEET_STATUSES.has(String(sheet.status || ""));
}

async function nextId(table: string): Promise<number> {
  const rows = await rest<AnyRow[]>(`/${table}?select=id&order=id.desc&limit=1`);
  return Number(rows[0]?.id || 0) + 1;
}

async function currentUser(): Promise<AnyRow | null> {
  const sub = decodeJwt()?.sub;
  if (!sub) return null;
  const rows = await rest<AnyRow[]>(
    `/employees?select=id,name,is_active,employee_profiles_v2(org_id,organizations(org_name)),user_roles(role)&auth_user_id=eq.${encodeURIComponent(sub)}&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;
  const profile = Array.isArray(row.employee_profiles_v2) ? row.employee_profiles_v2[0] : row.employee_profiles_v2;
  const roleRow = Array.isArray(row.user_roles) ? row.user_roles[0] : row.user_roles;
  return {
    id: Number(row.id),
    name: row.name,
    role: roleRow?.role || "employee",
    department: profile?.organizations?.org_name || "",
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
  const [rows, orgs, employees, labor] = await Promise.all([
    rest<AnyRow[]>("/projects?select=*&status=neq.deleted&order=code.asc"),
    rest<AnyRow[]>("/organizations?select=id,org_name"),
    rest<AnyRow[]>("/employees?select=id,name"),
    rest<AnyRow[]>("/timesheet_entries?select=id,project_id,hours,timesheets(status)"),
  ]);
  const orgNames = new Map(orgs.map((o) => [Number(o.id), o.org_name]));
  const employeeNames = new Map(employees.map((e) => [Number(e.id), e.name]));
  const hours = new Map<number, number>();
  const seenEntryIds = new Set<number>();
  for (const item of labor) {
    const entryId = Number(item.id);
    if (entryId && seenEntryIds.has(entryId)) continue;
    if (entryId) seenEntryIds.add(entryId);
    if (!isReportableTimesheet(item.timesheets)) continue;
    const projectId = Number(item.project_id);
    hours.set(projectId, (hours.get(projectId) || 0) + Number(item.hours || 0));
  }
  return rows.map((project) => {
    const contract = Number(project.contract_amount || 0);
    const received = Number(project.received_amount || 0);
    return {
      ...project,
      contract_amount: contract,
      received_amount: received,
      receivable_amount: Number(project.receivable_amount ?? Math.max(contract - received, 0)),
      owner_org_name: project.owner_org_id ? orgNames.get(Number(project.owner_org_id)) || null : null,
      project_owner_name: project.project_owner_id ? employeeNames.get(Number(project.project_owner_id)) || null : null,
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
  const [entries, overtime, tasks] = await Promise.all([
    rest<AnyRow[]>(
      `/timesheet_entries?select=*,projects(code,name)&timesheet_id=eq.${sheet.id}&order=project_id.asc,work_date.asc`,
    ),
    rest<AnyRow[]>(`/overtime_entries?select=*&timesheet_id=eq.${sheet.id}&order=work_date.asc`),
    rest<AnyRow[]>(`/workflow_tasks?select=*&workflow_key=eq.timesheet&target_type=eq.timesheet&target_id=eq.${sheet.id}`),
  ]);
  const taskProjectStatuses = projectStatusFromTasks(sheet, tasks);
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
  const [entries, overtime, userRows, profRows, tasks] = await Promise.all([
    rest<AnyRow[]>(
      `/timesheet_entries?select=*,projects(code,name)&timesheet_id=eq.${sheet.id}&order=project_id.asc,work_date.asc`,
    ),
    rest<AnyRow[]>(`/overtime_entries?select=*&timesheet_id=eq.${sheet.id}&order=work_date.asc`),
    rest<AnyRow[]>(`/employees?select=name&id=eq.${sheet.user_id}&limit=1`),
    rest<AnyRow[]>(`/employee_profiles_v2?select=organizations(org_name)&employee_id=eq.${sheet.user_id}&limit=1`),
    rest<AnyRow[]>(`/workflow_tasks?select=*&workflow_key=eq.timesheet&target_type=eq.timesheet&target_id=eq.${sheet.id}`),
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
    project_statuses: projectStatusFromTasks(sheet, tasks),
  };
}

async function saveTimesheet(body: AnyRow): Promise<AnyRow> {
  const sheet = await getTimesheet(body.weekStart);
  if (!["draft", "rejected"].includes(sheet.status)) {
    throw new Error("Submitted or approved timesheets cannot be edited");
  }
  const existingEntries = await rest<AnyRow[]>(
    `/timesheet_entries?select=*&timesheet_id=eq.${sheet.id}&order=project_id.asc,work_date.asc`,
  );
  const existingTasks = await rest<AnyRow[]>(
    `/workflow_tasks?select=*&workflow_key=eq.timesheet&target_type=eq.timesheet&target_id=eq.${sheet.id}`,
  );
  const lockedProjectIds = approvedProjectIds(existingTasks);
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
  // Fetch ALL pending tasks (not filtered by week — approval center shows everything)
  // Flat queries — avoid PostgREST embedded resources that need missing FKs
  const [tasks, reviewedTasks, employees, entries] = await Promise.all([
    rest<AnyRow[]>(`/workflow_tasks?select=*&workflow_key=eq.timesheet&target_type=eq.timesheet&status=eq.pending${taskFilter}`),
    rest<AnyRow[]>(`/workflow_tasks?select=*&workflow_key=eq.timesheet&target_type=eq.timesheet&status=eq.completed&result_action=in.(approve,reject)${admin ? "" : `&completed_by=eq.${user.id}`}`),
    rest<AnyRow[]>("/employees?select=id,name,employee_profiles_v2(organizations(org_name))"),
    rest<AnyRow[]>("/timesheet_entries?select=timesheet_id,project_id,hours"),
  ]);

  // Fetch ALL timesheets referenced by tasks (not filtered by week)
  const pendingSheetIds = [...new Set(tasks.map((t: AnyRow) => Number(t.target_id)))].filter(Boolean);
  const reviewedSheetIds = [...new Set(reviewedTasks.map((t: AnyRow) => Number(t.target_id)))].filter(Boolean);
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
      [...tasks, ...reviewedTasks]
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
    const profile = Array.isArray(emp?.employee_profiles_v2) ? emp.employee_profiles_v2[0] : emp?.employee_profiles_v2;
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
  const pending = tasks
    .map((task) => ({ task, sheet: sheetMap.get(Number(task.target_id)) }))
    .filter((item): item is { task: AnyRow; sheet: AnyRow } => !!item.sheet && item.sheet.status === "submitted")
    .sort((a, b) => (a.task.created_at || "").localeCompare(b.task.created_at || ""))
    .map(({ task, sheet }) => toItem(sheet, task));
  const reviewed = reviewedTasks
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
    rest<AnyRow[]>("/employees?select=id,name,employee_profiles_v2(organizations(org_name))"),
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

async function saveProject(body: AnyRow): Promise<AnyRow> {
  const row = {
    code: body.code,
    name: body.name,
    contract_amount: Number(body.contractAmount || body.contract_amount || 0),
    received_amount: Number(body.receivedAmount || body.received_amount || 0),
    owner_org_id: body.ownerOrgId || body.owner_org_id || null,
    project_owner_id: body.projectOwnerId || body.project_owner_id || null,
    status: "active",
  };
  if (body.id) {
    await rest(`/projects?id=eq.${body.id}`, { method: "PATCH", body: JSON.stringify(row) });
  } else {
    // Check for duplicate project code before inserting
    const existing = await rest<AnyRow[]>(
      `/projects?select=id&code=eq.${encodeURIComponent(row.code)}&status=neq.deleted&limit=1`,
    );
    if (existing.length > 0) {
      throw new Error(`项目代码「${row.code}」已存在，请更换代码后重试`);
    }
    await rest("/projects", { method: "POST", body: JSON.stringify([{ id: await nextId("projects"), ...row }]) });
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
  const contractType = body.contractType || body.contract_type || "labor";
  await rest(`/employees?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ name, employee_no: body.employeeNo || body.employee_no || `QS${String(id).padStart(6, "0")}`, is_active: (body.status || "active") !== "terminated" }) });
  await rest(`/employee_profiles_v2?employee_id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ org_id: body.orgId || body.org_id || null, position_name: body.positionName || body.position_name || "", employment_status: body.status || "active", manager_user_id: body.managerUserId || body.manager_user_id || null, hire_date: body.hireDate || body.hire_date || null }) });
  await rest(`/employee_contracts?employee_id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ is_current: false }) });
  await rest("/employee_contracts", { method: "POST", body: JSON.stringify([{ employee_id: id, contract_type: contractType, employment_type: body.employmentType || body.employment_type || "labor", is_current: true }]) });
  await rest(`/employee_salary_profiles?employee_id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ is_current: false }) });
  await rest("/employee_salary_profiles", { method: "POST", body: JSON.stringify([{ employee_id: id, salary_mode: contractType === "service" ? "daily_wage" : "monthly_salary", monthly_salary: contractType === "service" ? 0 : Number(body.monthlySalary || body.monthly_salary || 0), daily_wage: contractType === "service" ? Number(body.dailyWage || body.daily_wage || 0) : 0, is_current: true }]) });
  await rest(`/user_roles?employee_id=eq.${id}`, { method: "DELETE" });
  await rest("/user_roles", { method: "POST", body: JSON.stringify([{ employee_id: id, role: body.role || "employee" }]) });
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
    const [user, projectRows] = await Promise.all([currentUser(), projects()]);
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
  if (url.pathname === "/api/project-detail") {
    return projectDetail(url.searchParams.get("projectId") || "0", url.searchParams.get("startDate") || todayMonday(), url.searchParams.get("endDate") || todayMonday()) as T;
  }
  if (url.pathname === "/api/projects/save") return saveProject(body) as T;
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
