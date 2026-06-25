import { getStoredToken, clearStoredToken } from "./supabase";
import { accessRank, decodeJwt, payload, rest, type AnyRow } from "./restClient";
import { getTimesheetPeriodDays, isoDate, timesheetPeriodStartOfDate } from "@/utils/dates";

const CLIENT_ID = crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;

const REPORTABLE_TIMESHEET_STATUSES = new Set(["approved", "locked", "summarized"]);

function todayMonday(): string {
  return timesheetPeriodStartOfDate(isoDate(new Date()));
}

function weekDays(weekStart: string): string[] {
  return getTimesheetPeriodDays(weekStart);
}

function projectStatusFromReviews(reviews: AnyRow[], sheetStatus = ""): AnyRow[] {
  if (["rejected", "revision_required"].includes(String(sheetStatus || ""))) {
    return reviews.map((review) => ({
      project_id: Number(review.project_id),
      status: "rejected",
      assignee_role: review.route_source || "",
      result_action: review.status || "",
      completed_at: review.project_approved_at || review.final_confirmed_at || review.last_action_at || "",
    }));
  }

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

function normalizedApprovalTask(task: AnyRow): AnyRow {
  const resultAction =
    task.result_action ||
    (task.action === "approved" ? "approve" : task.action === "rejected" ? "reject" : task.action) ||
    (task.status === "approved" ? "approve" : task.status === "rejected" ? "reject" : "");
  return {
    ...task,
    id: Number(task.task_id || task.id),
    target_id: Number(task.target_id || task.timesheet_id || task.business_id),
    result_action: resultAction,
    completed_at: task.completed_at || task.acted_at || task.updated_at,
    created_at: task.created_at || task.activated_at,
  };
}

function latestPendingTasks(tasks: AnyRow[]): AnyRow[] {
  const latest = new Map<string, AnyRow>();
  for (const task of tasks) {
    const taskId = Number(task.task_id || task.id || 0);
    const key = taskId
      ? `node:${taskId}`
      : `${Number(task.target_id)}:${task.scope_type || "timesheet"}:${Number(task.scope_id || 0)}`;
    const current = latest.get(key);
    const currentTime = Date.parse(current?.created_at || "") || 0;
    const nextTime = Date.parse(task.created_at || "") || 0;
    const currentAssigneeIds = Array.isArray(current?.assignee_user_ids)
      ? current.assignee_user_ids.map(Number).filter(Boolean)
      : [];
    const nextAssigneeId = Number(task.assignee_user_id || 0);
    const assignee_user_ids = Array.from(
      new Set([...currentAssigneeIds, ...(nextAssigneeId ? [nextAssigneeId] : [])]),
    );
    const shouldUseNext =
      !current ||
      nextTime > currentTime ||
      (nextTime === currentTime && Number(task.id || 0) > Number(current.id || 0));
    latest.set(key, { ...(shouldUseNext ? task : current), assignee_user_ids });
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

function isLeaveProject(project?: AnyRow | null): boolean {
  return String(project?.work_kind || "project") === "leave";
}

function currentYearSuffix(): string {
  return String(new Date().getFullYear()).slice(-2);
}

function normalizeNumberPrefix(value?: string | null): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const EMPLOYEE_NUMBER_PREFIX_BY_ORG_CODE: Record<string, string> = {
  CC: "QS",
  COMP: "QS",
  PM: "PM",
  PMMANAGE: "PM",
  PMPROJECT: "PM",
  PMDESIGN: "DES",
  D009: "DES",
  D016: "HR",
  D008: "HR",
  D017: "DIR",
  PMCOST: "CM",
};

function employeeNumberPrefix(org?: AnyRow | null): string {
  const code = normalizeNumberPrefix(org?.org_code);
  const name = String(org?.org_name || "");
  if (code && EMPLOYEE_NUMBER_PREFIX_BY_ORG_CODE[code]) return EMPLOYEE_NUMBER_PREFIX_BY_ORG_CODE[code];
  if (name.includes("\u6210\u672c\u62db\u91c7")) return "CM";
  if (name.includes("\u9020\u4ef7") || name.includes("\u6210\u672c\u5408\u7ea6")) return "QS";
  if (name.includes("\u8bbe\u8ba1")) return "DES";
  if (name.includes("\u4eba\u4e8b")) return "HR";
  if (name.includes("\u8463\u4e8b")) return "DIR";
  if (code.startsWith("PM") || name.includes("\u9879\u76ee\u7ba1\u7406") || name.includes("\u5de5\u7a0b\u7ba1\u7406")) return "PM";
  return code || normalizeNumberPrefix(name);
}

function nextNumberFromRows(rows: AnyRow[], field: string, prefix: string): string {
  const normalizedPrefix = normalizeNumberPrefix(prefix);
  if (!normalizedPrefix) return "";
  const year = currentYearSuffix();
  const base = `${normalizedPrefix}${year}`;
  const pattern = new RegExp(`^${base}(\\d{3})$`, "i");
  const maxSeq = rows.reduce((max, row) => {
    const match = String(row[field] || "").toUpperCase().match(pattern);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${base}${String(maxSeq + 1).padStart(3, "0")}`;
}

async function nextProjectCode(businessType?: string | null): Promise<string> {
  const prefix = normalizeNumberPrefix(businessType || "");
  if (!prefix) return "";
  const rows = await rest<AnyRow[]>(
    `/projects?select=code&code=like.${encodeURIComponent(`${prefix}${currentYearSuffix()}%`)}`,
  );
  return nextNumberFromRows(rows, "code", prefix);
}

async function nextEmployeeNo(orgId?: number | null): Promise<string> {
  if (!orgId) return "";
  const orgRows = await rest<AnyRow[]>(
    `/organizations?select=org_code,org_name&id=eq.${orgId}&limit=1`,
  );
  const org = orgRows[0];
  const prefix = employeeNumberPrefix(org) || `D${String(orgId).padStart(3, "0")}`;
  const rows = await rest<AnyRow[]>(
    `/employees?select=employee_no&employee_no=like.${encodeURIComponent(`${prefix}${currentYearSuffix()}%`)}`,
  );
  return nextNumberFromRows(rows, "employee_no", prefix);
}

function employeeDailyRate(emp?: AnyRow | null): number {
  if (!emp) return 0;
  if (emp.contract_type === "service") return Number(emp.daily_wage || 0);
  const workdays = Number(emp.standard_monthly_workdays || 21.75);
  return Number(emp.monthly_salary || 0) / (workdays || 21.75);
}

async function currentUser(): Promise<AnyRow | null> {
  const sub = decodeJwt()?.sub;
  if (!sub) return null;
  const rows = await rest<AnyRow[]>(
    `/employees?select=id,name,is_active&auth_user_id=eq.${encodeURIComponent(sub)}&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;
  if (row.is_active === false) return null;

  const profile = (await rest<AnyRow[]>(
    `/employee_profiles?select=org_id,employment_status&employee_id=eq.${row.id}&limit=1`,
  ).catch(() => []))[0];
  const employmentStatus = String(profile?.employment_status || "active").toLowerCase();
  if (["terminated", "inactive", "resigned", "离职", "已离职"].includes(employmentStatus)) return null;

  const roles = await rest<AnyRow[]>(`/user_roles?select=role&employee_id=eq.${row.id}&limit=1`);
  const department = await (async () => {
    const orgRows = profile?.org_id
      ? await rest<AnyRow[]>(`/organizations?select=org_name&id=eq.${profile.org_id}&limit=1`)
      : [];
    return String(orgRows[0]?.org_name || "");
  })().catch(() => "");
  const roleRow = roles[0];
  const permissions = roleRow?.role ? await currentUserPermissions(roleRow.role) : {};
  const sidebarOrder = roleRow?.role ? await currentUserSidebarOrder(roleRow.role) : {};
  return {
    id: Number(row.id),
    name: row.name,
    role: roleRow?.role || "employee",
    department,
    is_active: row.is_active ? 1 : 0,
    permissions,
    sidebarOrder,
  };
}

async function currentUserPermissions(role: string): Promise<Record<string, string>> {
  const rows = await rest<AnyRow[]>(
    `/role_permissions?select=resource_key,access_level&role_key=eq.${encodeURIComponent(role)}`,
  ).catch(() => []);
  return Object.fromEntries(rows.map((row) => [String(row.resource_key), String(row.access_level || "none")]));
}

async function currentUserSidebarOrder(role: string): Promise<Record<string, number>> {
  const [permissions, resources] = await Promise.all([
    rest<AnyRow[]>(
      `/role_permissions?select=resource_key,sidebar_order&role_key=eq.${encodeURIComponent(role)}`,
    ).catch(() => []),
    rest<AnyRow[]>(
      "/permission_resources?select=resource_key,sort_order&resource_group=eq.sidebar&is_active=eq.true",
    ).catch(() => []),
  ]);
  const fallbackOrder = new Map(resources.map((resource) => [String(resource.resource_key), Number(resource.sort_order || 0)]));
  return Object.fromEntries(permissions
    .filter((row) => fallbackOrder.has(String(row.resource_key)))
    .map((row) => [
      String(row.resource_key),
      Number(row.sidebar_order ?? fallbackOrder.get(String(row.resource_key)) ?? 0),
    ]));
}

async function isAdmin(): Promise<boolean> {
  const user = await currentUser();
  return user?.role === "admin";
}

async function currentUserCanAccessResource(resourceKey: string, minAccess = "read"): Promise<boolean> {
  const user = await currentUser();
  if (!user) return false;
  return accessRank(user.permissions?.[resourceKey]) >= accessRank(minAccess);
}

async function listEmployees(): Promise<AnyRow[]> {
  const [rows, rolesRows] = await Promise.all([
    rest<AnyRow[]>(
      "/hr_employee_current_view?select=*&order=employee_id.asc",
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
    cost_specialty: row.cost_specialty || "",
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
    status: row.is_active === false
      ? "terminated"
      : String(row.employment_status || "active").toLowerCase(),
    standard_monthly_workdays: Number(row.standard_monthly_workdays || 21.75),
    };
  });
}

async function organizations(): Promise<AnyRow[]> {
  const [orgs, employees, managers] = await Promise.all([
    rest<AnyRow[]>("/organizations?select=*&status=eq.active&order=parent_id.asc,id.asc"),
    rest<AnyRow[]>("/employees?select=id,name"),
    rest<AnyRow[]>("/organization_managers?select=*&is_active=eq.true&manager_role=eq.department_owner&order=org_id.asc,updated_at.desc,id.desc").catch(() => []),
  ]);
  const names = new Map(employees.map((e) => [Number(e.id), e.name]));
  const managersByOrg = new Map<number, AnyRow[]>();
  for (const manager of managers) {
    const orgId = Number(manager.org_id);
    const rows = managersByOrg.get(orgId) || [];
    rows.push({
      ...manager,
      id: Number(manager.id),
      org_id: orgId,
      employee_id: Number(manager.employee_id),
      employee_name: names.get(Number(manager.employee_id)) || "",
      manager_role: manager.manager_role || "department_owner",
      is_active: manager.is_active !== false,
    });
    managersByOrg.set(orgId, rows);
  }
  return orgs.map((org) => ({
    ...org,
    managers: managersByOrg.get(Number(org.id)) || [],
    manager_ids: (managersByOrg.get(Number(org.id)) || []).map((manager) => Number(manager.employee_id)),
    manager_names: (managersByOrg.get(Number(org.id)) || []).map((manager) => manager.employee_name).filter(Boolean),
  }));
}

async function permissionConfig(): Promise<AnyRow> {
  const [roles, resources, permissions] = await Promise.all([
    rest<AnyRow[]>("/permission_roles?select=*&is_active=eq.true&order=sort_order.asc"),
    rest<AnyRow[]>("/permission_resources?select=*&is_active=eq.true&order=resource_group.asc,sort_order.asc"),
    rest<AnyRow[]>("/role_permissions?select=*&order=role_key.asc,resource_key.asc"),
  ]);
  return {
    roles: roles.map((role) => ({
      role_key: role.role_key,
      role_name: role.role_name,
      sort_order: Number(role.sort_order || 0),
      is_system: role.is_system !== false,
      is_active: role.is_active !== false,
    })),
    resources: resources.map((resource) => ({
      resource_key: resource.resource_key,
      resource_name: resource.resource_name,
      resource_group: resource.resource_group || "sidebar",
      sort_order: Number(resource.sort_order || 0),
      is_active: resource.is_active !== false,
    })),
    permissions: permissions.map((permission) => ({
      role_key: permission.role_key,
      resource_key: permission.resource_key,
      access_level: permission.access_level || "none",
      sidebar_order: Number(permission.sidebar_order ?? 0),
    })),
  };
}

async function savePermissionConfig(body: AnyRow): Promise<AnyRow> {
  const roleKey = String(body.roleKey || body.role_key || "");
  const updates = body.permissions || [];
  if (!roleKey) throw new Error("Role key is required");
  for (const item of updates) {
    const resourceKey = String(item.resourceKey || item.resource_key || "");
    const hasAccessLevel = item.accessLevel != null || item.access_level != null;
    const accessLevel = String(item.accessLevel || item.access_level || "none");
    const hasSidebarOrder = item.sidebarOrder != null || item.sidebar_order != null;
    const sidebarOrder = Number(item.sidebarOrder ?? item.sidebar_order ?? 0);
    if (!resourceKey) continue;
    try {
      if (hasAccessLevel) {
        if (!["none", "read", "write"].includes(accessLevel)) continue;
        await rest("/rpc/psa_save_role_permission", {
          method: "POST",
          body: JSON.stringify({
            p_role_key: roleKey,
            p_resource_key: resourceKey,
            p_access_level: accessLevel,
          }),
        });
      }
      if (hasSidebarOrder) {
        await rest("/rpc/psa_save_role_sidebar_order", {
          method: "POST",
          body: JSON.stringify({
            p_role_key: roleKey,
            p_resource_key: resourceKey,
            p_sidebar_order: sidebarOrder,
          }),
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown permission save error";
      throw new Error(`Permission save failed for ${roleKey}/${resourceKey}: ${message}`, {
        cause: error,
      });
    }
  }
  return { ok: true, ...(await permissionConfig()) };
}

function normalizeAppCenterItem(row: AnyRow): AnyRow {
  return {
    id: Number(row.id),
    app_key: String(row.app_key || ""),
    name: String(row.name || ""),
    description: String(row.description || ""),
    url: String(row.url || ""),
    icon_key: String(row.icon_key || "app"),
    tags: Array.isArray(row.tags) ? row.tags.map(String).filter(Boolean) : [],
    is_internal: row.is_internal === true,
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
  };
}

function appKeyFromName(name: string): string {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `app-${Date.now()}`;
}

async function appCenterItems(): Promise<AnyRow[]> {
  if (!(await currentUserCanAccessResource("apps", "read"))) {
    throw new Error("应用中心访问权限不足");
  }
  const canWrite = await currentUserCanAccessResource("apps", "write");
  const activeFilter = canWrite ? "" : "&is_active=eq.true";
  const rows = await rest<AnyRow[]>(
    `/app_center_items?select=*&order=sort_order.asc,name.asc${activeFilter}`,
  );
  return rows.map(normalizeAppCenterItem);
}

async function saveAppCenterItem(body: AnyRow): Promise<AnyRow> {
  if (!(await currentUserCanAccessResource("apps", "write"))) {
    throw new Error("应用中心维护权限不足");
  }

  const id = Number(body.id || 0);
  const name = String(body.name || "").trim();
  const url = String(body.url || "").trim();
  if (!name) throw new Error("应用名称不能为空");
  if (!/^https?:\/\//i.test(url)) throw new Error("应用地址需要以 http:// 或 https:// 开头");

  const tags = Array.isArray(body.tags)
    ? body.tags.map((tag: unknown) => String(tag).trim()).filter(Boolean)
    : [];
  const row = {
    app_key: String(body.app_key || "").trim() || appKeyFromName(name),
    name,
    description: String(body.description || "").trim(),
    url,
    icon_key: String(body.icon_key || "app").trim() || "app",
    tags,
    is_internal: body.is_internal === true,
    is_active: body.is_active !== false,
    sort_order: Number(body.sort_order ?? 100),
  };

  if (id > 0) {
    await rest(`/app_center_items?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify(row),
    });
  } else {
    await rest("/app_center_items", {
      method: "POST",
      body: JSON.stringify(row),
    });
  }
  return { ok: true, apps: await appCenterItems() };
}

async function deleteAppCenterItem(body: AnyRow): Promise<AnyRow> {
  if (!(await currentUserCanAccessResource("apps", "write"))) {
    throw new Error("应用中心维护权限不足");
  }
  const id = Number(body.id || 0);
  if (!id) throw new Error("应用 ID 不能为空");
  await rest(`/app_center_items?id=eq.${id}`, { method: "DELETE" });
  return { ok: true, apps: await appCenterItems() };
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
  const projectWorkKind = new Map(rows.map((project) => [Number(project.id), String(project.work_kind || "project")]));
  const hours = new Map<number, number>();
  const seenEntryIds = new Set<number>();
  for (const item of labor) {
    const entryId = Number(item.id);
    if (entryId && seenEntryIds.has(entryId)) continue;
    if (entryId) seenEntryIds.add(entryId);
    if (!isReportableTimesheet(sheetMap.get(Number(item.timesheet_id)))) continue;
    const projectId = Number(item.project_id);
    if (projectWorkKind.get(projectId) === "leave") continue;
    hours.set(projectId, (hours.get(projectId) || 0) + Number(item.hours || 0));
  }
  return rows.map((project) => {
    const contract = Number(project.contract_amount || 0);
    const received = Number(project.received_amount || 0);
    return {
      ...project,
      business_type: project.business_type || inferProjectBusinessType(project.code),
      work_kind: project.work_kind || "project",
      planned_labor_days: Number(project.planned_labor_days || 0),
      labor_budget_amount: Number(project.labor_budget_amount || 0),
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

async function projectRoleRequirements(businessType?: string | null): Promise<AnyRow[]> {
  const filter = businessType
    ? `&business_type=eq.${encodeURIComponent(businessType)}`
    : "";
  return rest<AnyRow[]>(
    `/project_role_requirements?select=*&is_active=eq.true${filter}&order=business_type.asc,sort_order.asc`,
  );
}

async function findTimesheet(userId: number, periodStart: string): Promise<AnyRow | null> {
  return (await rest<AnyRow[]>(
    `/timesheets?select=*&user_id=eq.${userId}&week_start_date=eq.${periodStart}&limit=1`,
  ))[0] || null;
}

function isTimesheetInsertConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /duplicate key value violates unique constraint|timesheets_pkey|timesheets_user_id_week_start_date_key/i.test(message);
}

async function getTimesheet(weekStart: string): Promise<AnyRow> {
  const periodStart = timesheetPeriodStartOfDate(weekStart);
  const user = await currentUser();
  if (!user) throw new Error("Not authenticated");
  let sheet = await findTimesheet(user.id, periodStart);
  if (!sheet) {
    try {
      sheet = (await rest<AnyRow[]>("/timesheets", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ user_id: user.id, week_start_date: periodStart }]),
      }))[0];
    } catch (error) {
      if (!isTimesheetInsertConflict(error)) throw error;
      sheet = await findTimesheet(user.id, periodStart);
      if (!sheet) throw error;
    }
  }
  const [entries, overtime, reviews] = await Promise.all([
    rest<AnyRow[]>(
      `/timesheet_entries?select=*,projects(code,name)&timesheet_id=eq.${sheet.id}&order=project_id.asc,work_date.asc`,
    ),
    rest<AnyRow[]>(`/overtime_entries?select=*&timesheet_id=eq.${sheet.id}&order=work_date.asc`),
    rest<AnyRow[]>(`/approval_project_review_records_view?select=*&timesheet_id=eq.${sheet.id}&order=project_id.asc,last_action_at.desc`)
      .catch(() => []),
  ]);
  const taskProjectStatuses = reviews.length ? projectStatusFromReviews(reviews, sheet.status) : [];
  const taskProjectIds = new Set(taskProjectStatuses.map((item) => Number(item.project_id)));
  const entryProjectIds = [...new Set(entries.map((entry) => Number(entry.project_id)).filter(Boolean))];
  return {
    ...sheet,
    days: weekDays(sheet.week_start_date),
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
  const [entries, overtime, userRows, profRows, reviews, approvalChainResult] = await Promise.all([
    rest<AnyRow[]>(
      `/timesheet_entries?select=*,projects(code,name)&timesheet_id=eq.${sheet.id}&order=project_id.asc,work_date.asc`,
    ),
    rest<AnyRow[]>(`/overtime_entries?select=*&timesheet_id=eq.${sheet.id}&order=work_date.asc`),
    rest<AnyRow[]>(`/employees?select=name&id=eq.${sheet.user_id}&limit=1`),
    rest<AnyRow[]>(`/employee_profiles?select=organizations(org_name)&employee_id=eq.${sheet.user_id}&limit=1`),
    rest<AnyRow[]>(`/approval_project_review_records_view?select=*&timesheet_id=eq.${sheet.id}&order=project_id.asc,last_action_at.desc`)
      .catch(() => []),
    rest<AnyRow[]>("/rpc/psa_timesheet_approval_chain", {
      method: "POST",
      body: JSON.stringify({ p_timesheet_id: Number(sheet.id) }),
    })
      .then((data) => ({ data, error: false }))
      .catch(() => ({ data: [] as AnyRow[], error: true })),
  ]);
  const userName = userRows[0]?.name || "";
  const profile = profRows[0];
  const projectInfoById = new Map<number, { code: string; name: string }>();
  for (const entry of entries) {
    const projectId = Number(entry.project_id);
    if (!projectId || projectInfoById.has(projectId)) continue;
    projectInfoById.set(projectId, {
      code: entry.projects?.code || "",
      name: entry.projects?.name || "",
    });
  }
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
    project_statuses: reviews.length ? projectStatusFromReviews(reviews, sheet.status) : [],
    approval_chain: approvalChainResult.data.map((node) => {
      const scopeId = node.scope_id == null ? null : Number(node.scope_id);
      const projectInfo = node.scope_type === "project" && scopeId ? projectInfoById.get(scopeId) : null;
      return {
        ...node,
        node_id: Number(node.node_id),
        scope_id: scopeId,
        project_code: projectInfo?.code || "",
        project_name: projectInfo?.name || "",
        sort_order: Number(node.sort_order ?? 9999),
        can_current_user_act: Boolean(node.can_current_user_act),
        assignees: Array.isArray(node.assignees) ? node.assignees : [],
        blocking_nodes: Array.isArray(node.blocking_nodes) ? node.blocking_nodes : [],
      };
    }),
    approval_chain_error: approvalChainResult.error,
  };
}

async function saveTimesheet(body: AnyRow): Promise<AnyRow> {
  const mergedEntries = new Map<string, AnyRow>();
  for (const entry of body.entries || []) {
    const hours = Number(entry.hours || 0);
    if (hours <= 0) continue;
    const key = `${entry.projectId}:${entry.workDate}`;
    const current = mergedEntries.get(key);
    if (current) {
      current.hours = Number(current.hours || 0) + hours;
      current.description = [current.description, entry.description].filter(Boolean).join("\n");
    } else {
      mergedEntries.set(key, { ...entry, hours });
    }
  }

  const payloadBody = {
    ...body,
    entries: Array.from(mergedEntries.values()),
  };
  const result = await rest<AnyRow>("/rpc/psa_save_timesheet", {
    method: "POST",
    body: JSON.stringify({ p_payload: payloadBody }),
  });
  const saved = result?.timesheet || {};
  return {
    ok: true,
    timesheet: await getTimesheet(saved.week_start_date || body.weekStart),
  };
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
  const [graphPending, graphReviewed, visibleRows, employees, employeeProfiles, entries] = await Promise.all([
    rest<AnyRow[]>(`/approval_pending_tasks_view?select=*&target_type=eq.timesheet${taskFilter}`).catch(() => []),
    rest<AnyRow[]>(`/approval_reviewed_timesheets_view?select=*&target_type=eq.timesheet${reviewedTaskFilter}`).catch(() => []),
    rest<AnyRow[]>("/approval_visible_timesheets_view?select=*&order=submitted_at.asc").catch(() => []),
    rest<AnyRow[]>("/employees?select=id,name"),
    rest<AnyRow[]>("/employee_profiles?select=employee_id,organizations(org_name,color_token)"),
    rest<AnyRow[]>("/timesheet_entries?select=timesheet_id,project_id,work_date,hours"),
  ]);
  const tasks = graphPending.map(normalizedApprovalTask);
  const reviewedTasks = graphReviewed
    .map(normalizedApprovalTask)
    .filter((task) => ["approve", "reject", "approved", "rejected"].includes(String(task.result_action)));
  const latestPending = latestPendingTasks(tasks);
  const latestReviewed = latestReviewedTasks(reviewedTasks);

  // Fetch ALL timesheets referenced by tasks (not filtered by week)
  const pendingSheetIds = [...new Set(latestPending.map((t: AnyRow) => Number(t.target_id)))].filter(Boolean);
  const reviewedSheetIds = [...new Set(latestReviewed.map((t: AnyRow) => Number(t.target_id)))].filter(Boolean);
  const visibleSheetIds = [...new Set(visibleRows.map((row: AnyRow) => Number(row.timesheet_id)))].filter(Boolean);
  const allSheetIds = [...new Set([...pendingSheetIds, ...reviewedSheetIds, ...visibleSheetIds])];
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
  const sheetMap = new Map(sheets.map((s) => [Number(s.id), s]));
  const hours = new Map<number, number>();
  const projectHours = new Map<string, number>();
  for (const entry of entries) {
    const sheetId = Number(entry.timesheet_id);
    const sheet = sheetMap.get(sheetId);
    if (!sheet) continue;
    const allowedDays = new Set(weekDays(sheet.week_start_date));
    if (!allowedDays.has(String(entry.work_date))) continue;
    const value = Number(entry.hours || 0);
    hours.set(sheetId, (hours.get(sheetId) || 0) + value);
    const key = `${sheetId}:${Number(entry.project_id)}`;
    projectHours.set(key, (projectHours.get(key) || 0) + value);
  }
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
    const assigneeNames = Array.isArray(source.assignee_user_ids)
      ? source.assignee_user_ids
          .map((id: number) => employeeMap.get(Number(id))?.name || `Employee ${id}`)
          .filter(Boolean)
          .join("、")
      : "";
    const action = String(source.result_action || "");
    const reviewStatus = ["rejected", "revision_required"].includes(String(sheet.status || ""))
      ? "rejected"
      : action === "approve" || action === "approved"
        ? "approved"
        : action === "reject" || action === "rejected"
          ? "rejected"
          : sheet.status;
    return {
      task_id: source.id ? Number(source.id) : undefined,
      timesheet_id: Number(sheet.id),
      user_id: Number(sheet.user_id),
      week_start_date: sheet.week_start_date,
      status: reviewStatus,
      assignee_role: source.assignee_role || "",
      scope_type: source.scope_type || "timesheet",
      scope_id: source.scope_id ? Number(source.scope_id) : null,
      project_id: projectId,
      project_code: project?.code || "",
      project_name: project?.name || "",
      name: emp?.name || "",
      department: profile?.organizations?.org_name || "",
      department_color_token: profile?.organizations?.color_token || null,
      total_hours: projectId ? projectHours.get(`${Number(sheet.id)}:${projectId}`) || 0 : hours.get(Number(sheet.id)) || 0,
      submitted_at: sheet.submitted_at,
      review_comment: source.comment || sheet.review_comment || "",
      current_assignee_names: source.current_assignee_names || assigneeNames,
      current_nodes: Array.isArray(source.current_nodes) ? source.current_nodes : [],
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
  const pendingSheetSet = new Set(pending.map((item) => Number(item.timesheet_id)));
  const inProgress = visibleRows
    .map((row) => ({ row, sheet: sheetMap.get(Number(row.timesheet_id)) }))
    .filter((item): item is { row: AnyRow; sheet: AnyRow } =>
      !!item.sheet &&
      item.sheet.status === "submitted" &&
      !pendingSheetSet.has(Number(item.sheet.id)),
    )
    .sort((a, b) => (a.row.submitted_at || "").localeCompare(b.row.submitted_at || ""))
    .map(({ row, sheet }) => {
      const currentAssignees = Array.isArray(row.current_assignees) ? row.current_assignees : [];
      const names = currentAssignees
        .map((assignee: AnyRow) => assignee.assignee_name || (assignee.assignee_user_id ? `员工 ${assignee.assignee_user_id}` : ""))
        .filter(Boolean)
        .join("、");
      return toItem(sheet, {
        target_id: row.timesheet_id,
        scope_type: "timesheet",
        scope_id: null,
        created_at: row.submitted_at,
        comment: names ? `当前待审批：${names}` : "尚未轮到你审批",
        current_assignee_names: names,
        current_nodes: row.current_nodes,
      });
    });
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
  return { timesheets: pending, inProgress, reviewed, overtime, overtimeReviewed };
}

async function weeklyReport(startDate: string, endDate: string): Promise<AnyRow> {
  const [entries, projectsData, sheets, employees] = await Promise.all([
    rest<AnyRow[]>(`/timesheet_entries?select=id,project_id,timesheet_id,work_date,hours&work_date=gte.${startDate}&work_date=lte.${endDate}`),
    rest<AnyRow[]>("/projects?select=id,code,name,work_kind"),
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
    if (isLeaveProject(projectMap.get(projectId))) continue;
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
  const [entries, projectRows, allSheets, allUsers, allProfs] = await Promise.all([
    rest<AnyRow[]>(`/timesheet_entries?select=id,timesheet_id,work_date,hours&project_id=eq.${projectId}&work_date=gte.${startDate}&work_date=lte.${endDate}`),
    rest<AnyRow[]>(`/projects?select=id,work_kind&id=eq.${projectId}&limit=1`),
    rest<AnyRow[]>("/timesheets?select=id,user_id,status"),
    rest<AnyRow[]>("/employees?select=id,name"),
    rest<AnyRow[]>("/employee_profiles?select=employee_id,organizations(org_name)"),
  ]);
  if (isLeaveProject(projectRows[0])) return [];
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
    rest<AnyRow[]>("/projects?select=id,code,name,status,work_kind&status=neq.deleted"),
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
    if (isLeaveProject(projectMap.get(projectId))) continue;
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

async function dashboardAnalysis(startDate: string, endDate: string, grain: string): Promise<AnyRow> {
  return rest<AnyRow>("/rpc/psa_dashboard_analysis", {
    method: "POST",
    body: JSON.stringify({
      p_start_date: startDate,
      p_end_date: endDate,
      p_grain: grain === "week" ? "week" : "month",
    }),
  });
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

async function approvalTemplates(): Promise<AnyRow[]> {
  if (!(await currentUserCanAccessResource("approval_config", "read"))) {
    throw new Error("Missing approval_config read permission");
  }

  const [templates, nodes, edges] = await Promise.all([
    rest<AnyRow[]>("/approval_templates?select=*&document_type=in.(contract,contract_approval)&order=business_type.asc,template_key.asc"),
    rest<AnyRow[]>("/approval_template_nodes?select=*&order=template_id.asc,sort_order.asc"),
    rest<AnyRow[]>("/approval_template_edges?select=*&order=template_id.asc,from_node_key.asc,to_node_key.asc"),
  ]);
  return templates.map((template) => ({
    ...template,
    nodes: nodes.filter((node) => Number(node.template_id) === Number(template.id)),
    edges: edges.filter((edge) => Number(edge.template_id) === Number(template.id)),
  }));
}

async function saveApprovalTemplate(body: AnyRow): Promise<AnyRow> {
  if (!(await currentUserCanAccessResource("approval_config", "write"))) {
    throw new Error("Missing approval_config write permission");
  }

  const templateId = Number(body.id || 0);
  if (!templateId) throw new Error("Template id is required");
  await rest("/rpc/psa_save_approval_template", {
    method: "POST",
    body: JSON.stringify({
      p_template_id: templateId,
      p_name: body.name,
      p_status: body.status || "active",
      p_version: Number(body.version || 1),
      p_nodes: body.nodes || [],
    }),
  });
  return { ok: true, templates: await approvalTemplates() };
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
  const workKind = body.workKind || body.work_kind || "project";
  const businessType = body.businessType || body.business_type || inferProjectBusinessType(body.code);
  const code = workKind === "leave" ? "LEAVE" : String(body.code || "").trim();
  const row = {
    code,
    name: workKind === "leave" ? "请假" : body.name,
    signed_date: body.signedDate || body.signed_date || null,
    business_type: workKind === "leave" ? null : businessType || inferProjectBusinessType(code),
    contract_amount: workKind === "leave" ? 0 : Number(body.contractAmount || body.contract_amount || 0),
    received_amount: workKind === "leave" ? 0 : Number(body.receivedAmount || body.received_amount || 0),
    planned_labor_days: workKind === "leave" ? 0 : Number(body.plannedLaborDays || body.planned_labor_days || 0),
    labor_budget_amount: workKind === "leave" ? 0 : Number(body.laborBudgetAmount || body.labor_budget_amount || 0),
    owner_org_id: workKind === "leave" ? null : body.ownerOrgId || body.owner_org_id || null,
    project_owner_id: workKind === "leave" ? null : body.projectOwnerId || body.project_owner_id || null,
    work_kind: workKind,
    status: "active",
  };
  if (projectId) {
    await rest("/rpc/psa_save_project", {
      method: "POST",
      body: JSON.stringify({
        p_project: { id: projectId, ...row },
        p_department_owners: body.departmentOwners || body.department_owners || [],
        p_project_roles: body.projectRoles || body.project_roles || [],
      }),
    });
    const previousOwnerId = existingProject[0]?.project_owner_id ? Number(existingProject[0].project_owner_id) : null;
    const nextOwnerId = row.project_owner_id ? Number(row.project_owner_id) : null;
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
    const saved = await rest<{ project_id: number; code?: string }>("/rpc/psa_save_project", {
      method: "POST",
      body: JSON.stringify({
        p_project: row,
        p_department_owners: body.departmentOwners || body.department_owners || [],
        p_project_roles: body.projectRoles || body.project_roles || [],
      }),
    });
    const newProjectId = Number(saved.project_id);
    if (newProjectId && (body.departmentOwners || body.department_owners || body.projectRoles || body.project_roles)) {
      await refreshProjectRoutes(newProjectId, "Route refreshed after project creation");
    }
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
    color_token: body.colorToken || body.color_token || null,
    status: "active",
  };
  const managerIds = (body.managerIds || body.manager_ids || [])
    .map((id: unknown) => Number(id || 0))
    .filter(Boolean);
  await rest("/rpc/psa_save_organization", {
    method: "POST",
    body: JSON.stringify({
      p_organization: body.id ? { id: body.id, ...row } : row,
      p_manager_ids: managerIds,
    }),
  });
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

  const id = Number(body.id);
  await rest("/rpc/psa_update_employee", {
    method: "POST",
    body: JSON.stringify({
      p_employee: {
        id,
        name,
        employee_no: body.employeeNo || body.employee_no || `QS${String(id).padStart(6, "0")}`,
        org_id: body.orgId || body.org_id || null,
        position_name: body.positionName || body.position_name || "",
        cost_specialty: body.costSpecialty || body.cost_specialty || null,
        status: body.status || "active",
        manager_user_id: body.managerUserId || body.manager_user_id || null,
        hire_date: body.hireDate || body.hire_date || null,
        contract_type: body.contractType || body.contract_type || "labor",
        employment_type: body.employmentType || body.employment_type || "labor",
        monthly_salary: body.monthlySalary || body.monthly_salary || 0,
        daily_wage: body.dailyWage || body.daily_wage || 0,
        role: body.role || "employee",
      },
    }),
  });
  return { ok: true, employees: await listEmployees() };
}

async function handleApi<T>(path: string, options: RequestInit): Promise<T> {
  const url = new URL(path, window.location.origin);
  const body = payload(options);
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
    return { currentUser: user, permissions: user?.permissions || {}, sidebarOrder: user?.sidebarOrder || {}, users: [], projects: projectRows, currentWeek: todayMonday(), dbRecommendation: "Supabase PostgREST" } as T;
  }
  if (url.pathname === "/api/organizations") return organizations() as T;
  if (url.pathname === "/api/employees") return listEmployees() as T;
  if (url.pathname === "/api/permissions") return permissionConfig() as T;
  if (url.pathname === "/api/apps") return appCenterItems() as T;
  if (url.pathname === "/api/projects") return projects() as T;
  if (url.pathname === "/api/project-role-requirements") {
    return projectRoleRequirements(url.searchParams.get("businessType")) as T;
  }
  if (url.pathname === "/api/numbering/employee") {
    return { code: await nextEmployeeNo(Number(url.searchParams.get("orgId") || 0)) } as T;
  }
  if (url.pathname === "/api/numbering/project") {
    return { code: await nextProjectCode(url.searchParams.get("businessType") || "") } as T;
  }
  if (url.pathname === "/api/approval-templates") return approvalTemplates() as T;
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
  if (url.pathname === "/api/dashboard/analysis") {
    const startDate = url.searchParams.get("startDate") || url.searchParams.get("weekStart") || todayMonday();
    const endDate = url.searchParams.get("endDate") || weekDays(startDate)[6];
    const grain = url.searchParams.get("grain") || "month";
    return dashboardAnalysis(startDate, endDate, grain) as T;
  }
  if (url.pathname === "/api/project-detail") {
    return projectDetail(url.searchParams.get("projectId") || "0", url.searchParams.get("startDate") || todayMonday(), url.searchParams.get("endDate") || todayMonday()) as T;
  }
  if (url.pathname === "/api/projects/save") return saveProject(body) as T;
  if (url.pathname === "/api/approval-templates/save") return saveApprovalTemplate(body) as T;
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
  if (url.pathname === "/api/apps/save") return saveAppCenterItem(body) as T;
  if (url.pathname === "/api/apps/delete") return deleteAppCenterItem(body) as T;
  if (url.pathname === "/api/employees/save") return saveEmployee(body) as T;
  if (url.pathname === "/api/permissions/save") return savePermissionConfig(body) as T;
  if (url.pathname === "/api/employees/delete") {
    await rest(`/employees?id=eq.${body.id}`, { method: "PATCH", body: JSON.stringify({ is_active: false }) });
    await rest(`/employee_profiles?employee_id=eq.${body.id}`, { method: "PATCH", body: JSON.stringify({ employment_status: "terminated" }) });
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
