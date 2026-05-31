const state = {
  clientId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  socket: null,
  socketRetry: null,
  sheetDirty: false,
  users: [],
  projects: [],
  currentUser: null,
  organizations: [],
  employees: [],
  editingEmployeeId: null,
  selectedEmployeeId: null,
  editingOrgId: null,
  employeeTab: "employee",
  approvalTab: "pending",
  sheet: null,
  rows: [],
  overtime: {},
  report: null,
  dashboard: null,
  projectBase: [],
  approvalTasks: null,
  reportTab: "labor",
  editingProjectId: null,
  reportPeriodType: "month",
  reportYear: new Date().getFullYear(),
  reportMonth: new Date().getMonth() + 1,
  reportQuarter: Math.floor(new Date().getMonth() / 3) + 1,
  reportStartDate: "",
  reportEndDate: "",
};

const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const holidayInfo = {
  "2026-01-01": { type: "rest", name: "元旦" },
  "2026-01-02": { type: "rest", name: "元旦" },
  "2026-01-03": { type: "rest", name: "元旦" },
  "2026-01-04": { type: "work", name: "调休上班" },
  "2026-02-14": { type: "work", name: "调休上班" },
  "2026-02-15": { type: "rest", name: "春节" },
  "2026-02-16": { type: "rest", name: "春节" },
  "2026-02-17": { type: "rest", name: "春节" },
  "2026-02-18": { type: "rest", name: "春节" },
  "2026-02-19": { type: "rest", name: "春节" },
  "2026-02-20": { type: "rest", name: "春节" },
  "2026-02-21": { type: "rest", name: "春节" },
  "2026-02-22": { type: "rest", name: "春节" },
  "2026-02-23": { type: "rest", name: "春节" },
  "2026-02-28": { type: "work", name: "调休上班" },
  "2026-04-04": { type: "rest", name: "清明" },
  "2026-04-05": { type: "rest", name: "清明" },
  "2026-04-06": { type: "rest", name: "清明" },
  "2026-05-01": { type: "rest", name: "劳动节" },
  "2026-05-02": { type: "rest", name: "劳动节" },
  "2026-05-03": { type: "rest", name: "劳动节" },
  "2026-05-04": { type: "rest", name: "劳动节" },
  "2026-05-05": { type: "rest", name: "劳动节" },
  "2026-05-09": { type: "work", name: "调休上班" },
  "2026-06-19": { type: "rest", name: "端午" },
  "2026-06-20": { type: "rest", name: "端午" },
  "2026-06-21": { type: "rest", name: "端午" },
  "2026-09-20": { type: "work", name: "调休上班" },
  "2026-09-25": { type: "rest", name: "中秋" },
  "2026-09-26": { type: "rest", name: "中秋" },
  "2026-09-27": { type: "rest", name: "中秋" },
  "2026-10-01": { type: "rest", name: "国庆" },
  "2026-10-02": { type: "rest", name: "国庆" },
  "2026-10-03": { type: "rest", name: "国庆" },
  "2026-10-04": { type: "rest", name: "国庆" },
  "2026-10-05": { type: "rest", name: "国庆" },
  "2026-10-06": { type: "rest", name: "国庆" },
  "2026-10-07": { type: "rest", name: "国庆" },
  "2026-10-10": { type: "work", name: "调休上班" },
};
const statusText = {
  draft: "草稿",
  submitted: "已提交",
  approved: "已通过",
  rejected: "已退回",
  locked: "已锁定",
  summarized: "已汇总",
};
const roleText = {
  employee: "员工",
  manager: "主管",
  admin: "管理员",
};

const $ = (selector) => document.querySelector(selector);

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(value, days) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function computeReportDateRange() {
  const t = state.reportPeriodType;
  const y = state.reportYear;
  let start, end;
  if (t === "month") {
    const m = state.reportMonth;
    start = `${y}-${String(m).padStart(2, "0")}-01`;
    end = `${y}-${String(m).padStart(2, "0")}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
  } else if (t === "quarter") {
    const q = state.reportQuarter;
    const qs = (q - 1) * 3 + 1;
    const qe = q * 3;
    start = `${y}-${String(qs).padStart(2, "0")}-01`;
    end = `${y}-${String(qe).padStart(2, "0")}-${String(lastDayOfMonth(y, qe)).padStart(2, "0")}`;
  } else {
    start = `${y}-01-01`;
    end = `${y}-12-31`;
  }
  state.reportStartDate = start;
  state.reportEndDate = end;
}

function initReportPeriod() {
  computeReportDateRange();
  const yearSelect = $("#reportYear");
  if (!yearSelect) return;
  yearSelect.innerHTML = "";
  const now = new Date().getFullYear();
  for (let y = now - 5; y <= now + 1; y++) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = `${y}年`;
    if (y === state.reportYear) opt.selected = true;
    yearSelect.appendChild(opt);
  }
  const monthSelect = $("#reportMonth");
  monthSelect.innerHTML = "";
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = `${m}月`;
    if (m === state.reportMonth) opt.selected = true;
    monthSelect.appendChild(opt);
  }
  const quarterSelect = $("#reportQuarter");
  quarterSelect.innerHTML = "";
  for (let q = 1; q <= 4; q++) {
    const opt = document.createElement("option");
    opt.value = q;
    opt.textContent = `Q${q} (${(q-1)*3+1}-${q*3}月)`;
    if (q === state.reportQuarter) opt.selected = true;
    quarterSelect.appendChild(opt);
  }
  updatePeriodDropdowns();
}

function updatePeriodDropdowns() {
  $("#reportMonth").hidden = state.reportPeriodType !== "month";
  $("#reportQuarter").hidden = state.reportPeriodType !== "quarter";
}

function mondayOfWeek(value) {
  const date = parseLocalDate(value);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return isoDate(date);
}

function weekdayName(value) {
  const index = (parseLocalDate(value).getDay() + 6) % 7;
  return dayNames[index];
}

function dayClass(value) {
  const info = holidayInfo[value];
  if (info?.type === "rest") return "calendar-day rest-day";
  if (info?.type === "work") return "calendar-day adjusted-workday";
  const day = parseLocalDate(value).getDay();
  return day === 0 || day === 6 ? "calendar-day weekend-day" : "calendar-day";
}

function dayHeader(day) {
  const info = holidayInfo[day];
  const badge = info ? `<span class="holiday-badge ${info.type}">${info.name}</span>` : "";
  return `<div class="${dayClass(day)}"><strong>${weekdayName(day)}</strong><span>${day.slice(5)}</span>${badge}</div>`;
}

function dayHeaderText(day) {
  const info = holidayInfo[day];
  return `${weekdayName(day)} ${day.slice(5)}${info ? ` ${info.name}` : ""}`;
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundPercent(value) {
  return Math.round((safeNumber(value) + Number.EPSILON) * 100) / 100;
}

function formatValue(value, digits = 2) {
  const number = safeNumber(value);
  return number ? String(Number(number.toFixed(digits))) : "";
}

function monthsBetween(startValue, endValue) {
  if (!startValue || !endValue) return 12;
  const start = parseLocalDate(startValue);
  const end = parseLocalDate(endValue);
  let months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
  return Math.max(months, 1);
}

function shortDate(value) {
  return value ? value.replaceAll("-", "").slice(2) : "";
}

function durationText(months) {
  if (!months) return "-";
  if (months < 12) return `${months}个月`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}年${rest}个月` : `${years}年`;
}

function employeePeriodText(item) {
  const start = item.hire_date || item.contract_start;
  const end = item.contract_end;
  if (!start || !end) return "-";
  const months = monthsBetween(start, item.contract_end);
  return `${shortDate(start)}-${shortDate(end)} ${durationText(months)}`;
}

function employeeTenureText(item) {
  const start = item.hire_date || item.contract_start;
  if (!start) return "-";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = parseLocalDate(start);
  if (startDate > today) return "未入职";
  let months = (today.getFullYear() - startDate.getFullYear()) * 12 + today.getMonth() - startDate.getMonth();
  if (today.getDate() >= startDate.getDate()) months += 1;
  return durationText(Math.max(months, 1));
}

function employeeSalaryText(item) {
  if (item.contract_type === "service") {
    return `劳务日薪 ${Number(item.daily_wage || 0).toLocaleString()}`;
  }
  return `劳动月薪 ${Number(item.monthly_salary || 0).toLocaleString()}`;
}

function isManagement(item) {
  return ["manager", "admin"].includes(item.role);
}

function managementPeople(orgId = null, excludeId = null) {
  return state.employees.filter((item) => {
    if (!isManagement(item)) return false;
    if (orgId && Number(item.org_id) !== Number(orgId)) return false;
    if (excludeId && Number(item.id) === Number(excludeId)) return false;
    return true;
  });
}

function managementOptions(orgId, selectedId, excludeId = null) {
  const scoped = managementPeople(orgId, excludeId);
  const fallback = scoped.length ? scoped : managementPeople(null, excludeId);
  return fallback
    .map((item) => `<option value="${item.id}" ${Number(selectedId) === item.id ? "selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(item.org_name || item.department || "未分配部门")}</option>`)
    .join("");
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node.classList.remove("show"), 2400);
}

function ensureOk(result) {
  if (!result?.ok) throw new Error(result?.message || "操作未完成，请稍后重试");
  return result;
}

async function withBusyButton(button, busyText, task) {
  const previousText = button?.textContent || "";
  if (button) {
    button.disabled = true;
    button.textContent = busyText;
  }
  try {
    return await task();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "X-Client-Id": state.clientId,
    ...(options.headers || {}),
  };
  const response = await fetch(path, {
    ...options,
    headers,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.message || text || "请求失败");
  return data;
}

async function boot() {
  bindLoginEvents();
  const data = await api("/api/bootstrap");
  state.currentUser = data.currentUser;
  if (!state.currentUser) {
    showLogin();
    return;
  }

  showApp();
  state.users = data.users;
  state.projects = data.projects;
  $("#weekStart").value = mondayOfWeek(data.currentWeek);
  bindEvents();
  configureNavigation();
  initReportPeriod();
  await loadTimesheet();
  if (canReview()) await loadReport();
  if (isAdmin()) await loadEmployees();
  connectRealtime();
}

function bindLoginEvents() {
  $("#loginButton").addEventListener("click", login);
  $("#loginPassword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") login();
  });
  $("#loginName").addEventListener("input", clearLoginError);
  $("#loginPassword").addEventListener("input", clearLoginError);
  $("#showPasswordForm").addEventListener("click", togglePasswordPanel);
  $("#changePasswordButton").addEventListener("click", changePassword);
}

function showLogin() {
  $("#loginScreen").classList.add("active");
  document.querySelector(".app-shell").style.display = "none";
}

function showApp() {
  $("#loginScreen").classList.remove("active");
  document.querySelector(".app-shell").style.display = "grid";
  $("#currentUser").textContent = `${state.currentUser.department || "未分配部门"} · ${state.currentUser.name} · ${roleText[state.currentUser.role] || state.currentUser.role}`;
  $("#systemRole").textContent = roleText[state.currentUser.role] || "内部管理";
  $("#changeLoginName").value = "";
}

function togglePasswordPanel() {
  const panel = $("#passwordPanel");
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    $("#changeLoginName").value = $("#loginName").value.trim();
    $("#oldPassword").value = "";
    $("#newPassword").value = "";
    $("#confirmPassword").value = "";
    $("#oldPassword").focus();
  }
}

async function changePassword() {
  const login = $("#changeLoginName").value.trim() || $("#loginName").value.trim();
  const oldPassword = $("#oldPassword").value;
  const newPassword = $("#newPassword").value;
  const confirmPassword = $("#confirmPassword").value;
  if (newPassword !== confirmPassword) {
    toast("两次输入的新密码不一致");
    return;
  }
  try {
    const result = ensureOk(await api("/api/password/change", {
      method: "POST",
      body: JSON.stringify({ login, oldPassword, newPassword }),
    }));
    if (!result.ok) return;
    toast("密码已修改，请重新登录");
    window.setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    toast(error.message);
  }
}

function clearLoginError() {
  const el = $("#loginError");
  if (el) el.textContent = "";
}

async function login() {
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        login: $("#loginName").value.trim(),
        password: $("#loginPassword").value,
      }),
    });
    window.location.reload();
  } catch (error) {
    const el = $("#loginError");
    if (el) el.textContent = error.message || "登录失败，请重试";
  }
}

function isAdmin() {
  return state.currentUser?.role === "admin" || ["admin", "鞠松松"].includes(state.currentUser?.name) || state.currentUser?.id === 18;
}

function canReview() {
  return ["manager", "admin"].includes(state.currentUser?.role) || ["admin", "鞠松松"].includes(state.currentUser?.name) || state.currentUser?.id === 18;
}

function syncUsersFromEmployees() {
  state.users = state.employees.map((item) => ({
    id: item.id,
    name: item.name,
    role: item.role,
    department: item.org_name || item.department || "",
  }));
  const current = state.users.find((item) => item.id === state.currentUser?.id);
  if (current) {
    state.currentUser = { ...state.currentUser, ...current };
    showApp();
  }
}

function configureNavigation() {
  document.querySelectorAll("[data-admin-only]").forEach((node) => {
    node.style.display = isAdmin() ? "" : "none";
  });
  document.querySelectorAll("[data-review-only]").forEach((node) => {
    node.style.display = canReview() ? "" : "none";
  });
}

function bindEvents() {
  $("#weekStart").addEventListener("change", async () => {
    $("#weekStart").value = mondayOfWeek($("#weekStart").value);
    await loadTimesheet();
    if (canReview()) await loadReport();
  });
  $("#prevWeek").addEventListener("click", () => shiftWeek(-7));
  $("#nextWeek").addEventListener("click", () => shiftWeek(7));
  $("#saveDraft").addEventListener("click", saveDraft);
  $("#submitSheet").addEventListener("click", submitSheet);
  $("#refreshReview").addEventListener("click", loadReport);
  $("#refreshDashboard").addEventListener("click", loadReport);
  $("#refreshEmployees").addEventListener("click", loadEmployees);
  $("#newProject").addEventListener("click", newProject);
  $("#newEmployee").addEventListener("click", () => newEmployeeWithRole(state.employeeTab === "management" ? "manager" : "employee"));
  $("#deleteEmployeeToolbar").addEventListener("click", deleteSelectedEmployee);
  $("#newOrg").addEventListener("click", newOrganization);
  $("#orgSearch").addEventListener("input", renderOrganizations);
  $("#reminderInfoBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const float = $("#reminderFloat");
    float.hidden = !float.hidden;
  });
  $("#reminderCloseBtn").addEventListener("click", () => {
    $("#reminderFloat").hidden = true;
  });
  document.addEventListener("click", (e) => {
    const float = $("#reminderFloat");
    if (!float.hidden && !e.target.closest("#reminderFloat") && !e.target.closest("#reminderInfoBtn")) {
      float.hidden = true;
    }
  });
  $("#exportCsv").addEventListener("click", exportCsv);

  document.querySelectorAll('input[name="reportPeriod"]').forEach((r) => {
    r.addEventListener("change", () => {
      state.reportPeriodType = r.value;
      updatePeriodDropdowns();
      computeReportDateRange();
      loadReport();
    });
  });
  $("#reportYear").addEventListener("change", () => {
    state.reportYear = Number($("#reportYear").value);
    computeReportDateRange();
    loadReport();
  });
  $("#reportMonth").addEventListener("change", () => {
    state.reportMonth = Number($("#reportMonth").value);
    computeReportDateRange();
    loadReport();
  });
  $("#reportQuarter").addEventListener("change", () => {
    state.reportQuarter = Number($("#reportQuarter").value);
    computeReportDateRange();
    loadReport();
  });
  $("#logoutButton").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    window.location.reload();
  });
  $("#changePasswordTopButton").addEventListener("click", () => {
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    showLogin();
    $("#loginName").value = "";
    $("#loginPassword").value = "";
    if ($("#passwordPanel").hidden) togglePasswordPanel();
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.view}View`).classList.add("active");
      setPageTitle(button.dataset.view);
      if (["review", "report", "dashboard"].includes(button.dataset.view)) await loadReport();
      if (button.dataset.view === "employees") await loadEmployees();
    });
  });
  document.addEventListener("change", (event) => {
    const employeeMode = event.target.closest('input[name="employeeMode"]');
    if (employeeMode) {
      setEmployeeMode(employeeMode.value);
      return;
    }
    const approvalMode = event.target.closest('input[name="approvalMode"]');
    if (approvalMode) {
      state.approvalTab = approvalMode.value;
      renderReview();
      return;
    }
    const reportMode = event.target.closest('input[name="reportMode"]');
    if (reportMode) {
      state.reportTab = reportMode.value;
      state.editingProjectId = null;
      renderReport();
    }
  });
  document.addEventListener("click", (event) => {
    const approvalTab = event.target.closest("[data-approval-tab]");
    if (approvalTab) {
      state.approvalTab = approvalTab.dataset.approvalTab;
      renderReview();
    }
  });
}

function setEmployeeMode(mode) {
  if (!["employee", "management"].includes(mode)) return;
  state.employeeTab = mode;
  state.editingEmployeeId = null;
  state.selectedEmployeeId = null;
  state.employees = state.employees.filter((item) => item.id !== 0);
  renderEmployees();
}

function activeViewName() {
  return document.querySelector(".view.active")?.id?.replace(/View$/, "") || "timesheet";
}

function hasOrgOrEmployeeDraft() {
  return state.editingEmployeeId !== null || state.editingOrgId !== null;
}

function connectRealtime() {
  if (!state.currentUser || state.socket) return;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws/sync?clientId=${encodeURIComponent(state.clientId)}`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    if (state.socketRetry) window.clearTimeout(state.socketRetry);
    state.socketRetry = null;
  });

  socket.addEventListener("message", async (event) => {
    let payload = {};
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.type !== "sync" || payload.sourceClientId === state.clientId) return;
    await handleRemoteSync(payload.modules || []);
  });

  socket.addEventListener("close", () => {
    state.socket = null;
    if (!state.currentUser) return;
    state.socketRetry = window.setTimeout(connectRealtime, 3000);
  });
}

async function handleRemoteSync(modules) {
  const view = activeViewName();
  try {
    if (isAdmin() && modules.some((item) => ["employees", "organizations"].includes(item))) {
      if (view === "employees") {
        if (hasOrgOrEmployeeDraft()) {
          toast("其他设备更新了员工/组织数据，保存或取消当前编辑后会刷新。");
          return;
        }
        await loadEmployees();
        toast("员工/组织数据已同步");
      }
    }

    if (modules.includes("timesheet") && view === "timesheet") {
      if (state.sheetDirty) {
        toast("其他设备更新了周表，保存或刷新后查看最新数据。");
      } else {
        await loadTimesheet();
        toast("周表已同步");
      }
    }

    if (canReview() && modules.some((item) => ["approvals", "reports"].includes(item)) && ["review", "report", "dashboard"].includes(view)) {
      await loadReport();
      toast("审批/汇总数据已同步");
    }
  } catch (error) {
    toast(error.message);
  }
}

function setPageTitle(view) {
  const titles = {
    timesheet: ["我的周表", ""],
    dashboard: ["数据看板", "查看项目合同、回款、人力成本和毛利表现。"],
    review: ["审批中心", "主管审核已提交周表，退回时需要说明原因。"],
    report: ["项目汇总", "按项目查看本周投入工日，支持导出 CSV。"],
    employees: ["员工与组织架构", "管理员维护员工、部门、合同类型和薪酬基础。"],
  };
  const [title, subtitle] = titles[view] || titles.timesheet;
  $("#pageTitle").textContent = title;
  $("#pageSubtitle").textContent = subtitle;
}

function addProjectRow() {
  state.rows.push({ projectId: state.projects[0].id, descriptions: {}, percents: {} });
  renderSheet();
}

function shiftWeek(days) {
  $("#weekStart").value = mondayOfWeek(addDays($("#weekStart").value, days));
  loadTimesheet();
  if (canReview()) loadReport();
}

async function loadTimesheet() {
  const weekStart = mondayOfWeek($("#weekStart").value);
  $("#weekStart").value = weekStart;
  state.sheet = await api(`/api/timesheet?weekStart=${weekStart}`);
  state.rows = normalizeRows(state.sheet.entries);
  state.overtime = normalizeOvertime(state.sheet.overtime || []);
  state.sheetDirty = false;
  if (!state.rows.length) addEmptyRow();
  renderSheet();
}

function addEmptyRow() {
  state.rows.push({ projectId: state.projects[0]?.id, descriptions: {}, percents: {} });
}

function normalizeRows(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    if (!map.has(entry.project_id)) {
      map.set(entry.project_id, {
        projectId: entry.project_id,
        percents: {},
        descriptions: {},
      });
    }
    const row = map.get(entry.project_id);
    row.percents[entry.work_date] = roundPercent(entry.hours * 100);
    row.descriptions[entry.work_date] = entry.description || "";
  });
  return Array.from(map.values());
}

function normalizeOvertime(items) {
  const overtime = {};
  items.forEach((item) => {
    overtime[item.work_date] = {
      hours: safeNumber(item.overtime_hours),
      reason: item.reason || "",
      status: item.status || "pending",
      rejectComment: item.reject_comment || "",
    };
  });
  return overtime;
}

function renderSheet() {
  const sheet = state.sheet;
  const weekEnd = addDays(sheet.week_start_date, 6);
  $("#sheetOwner").textContent = "";
  $("#weekTitle").textContent = `${sheet.week_start_date} 至 ${weekEnd}`;
  $("#remark").value = sheet.remark || "";
  const status = $("#statusBadge");
  status.textContent = statusText[sheet.status] || sheet.status;
  status.className = `status ${sheet.status}`;

  const lockedSheet = ["submitted", "approved", "locked", "summarized"].includes(sheet.status);
  $("#saveDraft").disabled = lockedSheet;
  $("#submitSheet").disabled = lockedSheet || hasBlockingError();

  const header = [
    `<thead><tr><th><div class="project-head"><span>项目</span><button id="addProjectInline" class="mini-btn" type="button" aria-label="添加项目行" title="添加项目行" ${lockedSheet ? "disabled" : ""}>+</button></div></th>`,
    ...sheet.days.map((day) => `<th>${dayHeader(day)}</th>`),
    "<th>周合计</th><th>备注</th></tr></thead>",
  ].join("");

  const bodyRows = state.rows.map((row, rowIndex) => {
    const cells = sheet.days.map((day) => {
      const value = formatValue(row.percents[day], 2);
      return `<td class="${dayPercent(day) > 100.0001 ? "invalid-cell" : ""}">
        <div class="percent-cell">
          <input class="percent-input" type="number" min="0" max="100" step="1" inputmode="decimal" name="percent-${rowIndex}-${day}" aria-label="${dayHeaderText(day)}项目占比" value="${value}" data-row="${rowIndex}" data-day="${day}" ${lockedSheet ? "disabled" : ""}>
          <span>%</span>
        </div>
      </td>`;
    });
    const options = state.projects
      .map((project) => `<option value="${project.id}" ${project.id === row.projectId ? "selected" : ""}>${project.code} ${project.name}</option>`)
      .join("");
    const description = Object.values(row.descriptions).find(Boolean) || "";
    return `<tr>
      <td><div class="project-cell"><select data-project-row="${rowIndex}" name="project-${rowIndex}" aria-label="项目" ${lockedSheet ? "disabled" : ""}>${options}</select><button class="mini-btn" type="button" data-remove-row="${rowIndex}" aria-label="删除项目行" title="删除项目行" ${lockedSheet ? "disabled" : ""}>×</button></div></td>
      ${cells.join("")}
      <td class="row-total">${(rowPercent(row) / 100).toFixed(2)}</td>
      <td><input type="text" name="description-${rowIndex}" autocomplete="off" aria-label="项目工作内容备注" value="${escapeHtml(description)}" data-desc-row="${rowIndex}" ${lockedSheet ? "disabled" : ""}></td>
    </tr>`;
  });

  const totalCells = sheet.days
    .map((day) => `<td class="day-total ${dayPercent(day) > 100.0001 ? "invalid-total" : ""}" data-total-day="${day}">${dayPercent(day).toFixed(0)}%</td>`)
    .join("");
  const overtimeCells = sheet.days
    .map((day) => `<td><input class="overtime-input" type="number" min="0" step="0.5" inputmode="decimal" name="overtime-${day}" aria-label="${dayHeaderText(day)}加班时长" value="${formatValue(state.overtime[day]?.hours, 1)}" data-overtime-day="${day}" ${lockedSheet ? "disabled" : ""}></td>`)
    .join("");
  const footer = `<tfoot>
    <tr><th>每日合计</th>${totalCells}<th id="weekWorkdayTotal">${weekWorkdays().toFixed(2)}</th><th>工日</th></tr>
    <tr><th>加班时长</th>${overtimeCells}<th id="weekOvertimeTotal">${weekOvertime().toFixed(1)}</th><th>小时</th></tr>
  </tfoot>`;
  $("#timesheetTable").innerHTML = `${header}<tbody>${bodyRows.join("")}</tbody>${footer}`;
  bindSheetInputs();
  $("#addProjectInline")?.addEventListener("click", addProjectRow);
  renderWarnings();
}

function bindSheetInputs() {
  document.querySelectorAll(".percent-input").forEach((input) => {
    input.addEventListener("input", () => {
      const row = state.rows[Number(input.dataset.row)];
      row.percents[input.dataset.day] = Math.max(0, roundPercent(input.value));
      state.sheetDirty = true;
      renderWarnings();
      updateRenderedTotals();
    });
  });

  document.querySelectorAll(".overtime-input").forEach((input) => {
    input.addEventListener("input", () => {
      state.overtime[input.dataset.overtimeDay] = {
        ...(state.overtime[input.dataset.overtimeDay] || {}),
        hours: Math.max(0, safeNumber(input.value)),
        reason: "",
      };
      state.sheetDirty = true;
      renderWarnings();
      updateRenderedTotals();
    });
  });

  document.querySelectorAll("[data-project-row]").forEach((select) => {
    select.addEventListener("change", () => {
      state.rows[Number(select.dataset.projectRow)].projectId = Number(select.value);
      state.sheetDirty = true;
    });
  });

  document.querySelectorAll("[data-remove-row]").forEach((button) => {
    button.addEventListener("click", () => {
      state.rows.splice(Number(button.dataset.removeRow), 1);
      if (!state.rows.length) addEmptyRow();
      renderSheet();
    });
  });

  document.querySelectorAll("[data-desc-row]").forEach((input) => {
    input.addEventListener("input", () => {
      const row = state.rows[Number(input.dataset.descRow)];
      state.sheet.days.forEach((day) => {
        if (row.percents[day]) row.descriptions[day] = input.value;
      });
      state.sheetDirty = true;
    });
  });
  $("#remark").addEventListener("input", () => {
    state.sheetDirty = true;
  }, { once: true });
}

function updateRenderedTotals() {
  $("#totalHours").textContent = `${weekWorkdays().toFixed(2)} 工日`;
  $("#dailySummary").textContent = state.sheet.days.map((day) => `${dayPercent(day).toFixed(0)}%`).join(" / ");
  state.sheet.days.forEach((day) => {
    const cell = document.querySelector(`[data-total-day="${day}"]`);
    if (!cell) return;
    const total = dayPercent(day);
    cell.textContent = `${total.toFixed(0)}%`;
    cell.classList.toggle("invalid-total", total > 100.0001);
    document.querySelectorAll(`.percent-input[data-day="${day}"]`).forEach((input) => {
      input.closest("td")?.classList.toggle("invalid-cell", total > 100.0001);
    });
  });
  const weekWorkdayTotal = $("#weekWorkdayTotal");
  if (weekWorkdayTotal) weekWorkdayTotal.textContent = weekWorkdays().toFixed(2);
  const weekOvertimeTotal = $("#weekOvertimeTotal");
  if (weekOvertimeTotal) weekOvertimeTotal.textContent = weekOvertime().toFixed(1);
}

function rowPercent(row) {
  return state.sheet.days.reduce((sum, day) => sum + safeNumber(row.percents[day]), 0);
}

function dayPercent(day) {
  return state.rows.reduce((sum, row) => sum + safeNumber(row.percents[day]), 0);
}

function weekWorkdays() {
  return state.sheet.days.reduce((sum, day) => sum + dayPercent(day) / 100, 0);
}

function weekOvertime() {
  return state.sheet.days.reduce((sum, day) => sum + safeNumber(state.overtime[day]?.hours), 0);
}

function hasBlockingError() {
  return state.sheet.days.some((day) => dayPercent(day) > 100.0001);
}

function renderWarnings() {
  const warnings = [];
  state.sheet.days.forEach((day, index) => {
    const total = dayPercent(day);
    if (total > 100.0001) warnings.push(`${dayNames[index]}合计 ${total.toFixed(0)}%，超过 100%，不能提交`);
    if (total > 0 && total < 99.999) warnings.push(`${dayNames[index]}合计 ${total.toFixed(0)}%，未满 1 工日`);
    if (total === 0) warnings.push(`${dayNames[index]}尚未填写项目比例`);
  });
  if (weekWorkdays() < 5.999) warnings.push(`本周合计 ${weekWorkdays().toFixed(2)} 工日，低于满勤 6 工日`);
  if (weekOvertime() > 0) warnings.push(`本周记录加班 ${weekOvertime().toFixed(1)} 小时，可用于后续倒休安排`);
  Object.entries(state.overtime).forEach(([day, item]) => {
    if (item.status === "rejected") {
      warnings.push(`${day} OT 已退回${item.rejectComment ? `：${item.rejectComment}` : ""}`);
    }
  });
  if (state.rows.some((row) => rowPercent(row) > 0 && !Object.values(row.descriptions).find(Boolean))) {
    warnings.push("存在项目行缺少工作内容备注");
  }
  if (!warnings.length) warnings.push("每日合计均为 100%，本周满勤 6 工日，可以提交。");
  $("#warnings").innerHTML = warnings.map((item) => `<li>${item}</li>`).join("");
  updateRenderedTotals();
  $("#submitSheet").disabled = ["submitted", "approved", "locked", "summarized"].includes(state.sheet.status) || hasBlockingError();
}

async function saveDraft() {
  try {
    const result = await api("/api/timesheet/save", {
      method: "POST",
      body: JSON.stringify(buildPayload()),
    });
    if (!result.ok) return toast(result.message);
    state.sheet = result.timesheet;
    state.rows = normalizeRows(result.timesheet.entries);
    state.overtime = normalizeOvertime(result.timesheet.overtime || []);
    state.sheetDirty = false;
    renderSheet();
    if (canReview()) await loadReport();
    toast("草稿已保存");
  } catch (error) {
    toast(error.message);
  }
}

async function submitSheet() {
  if (hasBlockingError()) {
    toast("存在每日合计超过 100%，不能提交");
    renderWarnings();
    return;
  }
  await saveDraft();
  try {
    const result = await api("/api/timesheet/action", {
      method: "POST",
      body: JSON.stringify({ timesheetId: state.sheet.id, action: "submit" }),
    });
    if (!result.ok) return toast(result.message);
    state.sheet = result.timesheet;
    state.rows = normalizeRows(result.timesheet.entries);
    state.overtime = normalizeOvertime(result.timesheet.overtime || []);
    state.sheetDirty = false;
    renderSheet();
    if (canReview()) await loadReport();
    toast("已提交主管审核");
  } catch (error) {
    toast(error.message);
  }
}

function buildPayload() {
  const entries = [];
  state.rows.forEach((row) => {
    state.sheet.days.forEach((day) => {
      const percent = roundPercent(row.percents[day]);
      if (percent > 0) {
        entries.push({
          projectId: row.projectId,
          workDate: day,
          hours: roundPercent(percent / 100),
          description: row.descriptions[day] || Object.values(row.descriptions).find(Boolean) || "",
        });
      }
    });
  });
  const overtime = state.sheet.days
    .map((day) => ({
      workDate: day,
      hours: safeNumber(state.overtime[day]?.hours),
      reason: state.overtime[day]?.reason || "",
    }))
    .filter((item) => item.hours > 0);
  return {
    weekStart: $("#weekStart").value,
    remark: $("#remark").value,
    entries,
    overtime,
  };
}

async function loadReport() {
  if (!canReview()) return;
  const weekStart = $("#weekStart").value;
  computeReportDateRange();
  const reportUrl = state.reportStartDate && state.reportEndDate
    ? `/api/reports/weekly?startDate=${state.reportStartDate}&endDate=${state.reportEndDate}`
    : `/api/reports/weekly?weekStart=${weekStart}`;
  const [report, dashboard, projectBase, approvalTasks] = await Promise.all([
    api(reportUrl),
    api(`/api/project-dashboard?weekStart=${weekStart}`),
    api("/api/projects"),
    api(`/api/approvals/tasks?weekStart=${weekStart}`),
  ]);
  state.report = report;
  state.dashboard = dashboard;
  state.projectBase = projectBase;
  state.approvalTasks = approvalTasks;
  state.otPending = state.approvalTasks.overtime || [];
  renderReview();
  renderReport();
  renderDashboard();
}

async function loadEmployees() {
  if (!isAdmin()) return;
  const [orgs, employees] = await Promise.all([
    api("/api/organizations"),
    api("/api/employees"),
  ]);
  state.organizations = orgs;
  state.employees = employees;
  if (!state.employees.some((item) => item.id === state.selectedEmployeeId)) state.selectedEmployeeId = null;
  syncUsersFromEmployees();
  renderOrganizations();
  renderEmployees();
  renderEmployeeReminders();
}

function renderOrganizations() {
  const keyword = ($("#orgSearch")?.value || "").trim().toLowerCase();
  const organizations = state.organizations.filter((org) => {
    const manager = state.employees.find((user) => user.id === org.manager_user_id);
    return `${org.org_name} ${manager?.name || ""}`.toLowerCase().includes(keyword);
  });
  $("#orgList").innerHTML = organizations
    .map((org) => {
      if (state.editingOrgId === org.id) {
        return `<div class="org-item org-edit-item">
          <div><strong>${org.parent_id ? "　" : ""}${escapeHtml(org.org_name)}</strong><span>编辑中…</span></div>
          <div class="org-actions">
            <button class="primary compact-action" type="button" data-org-save="${org.id || ""}">保存</button>
            <button class="secondary compact-action" type="button" data-org-cancel>取消</button>
          </div>
        </div>${organizationEditDrawer(org)}`;
      }
      const manager = state.employees.find((user) => user.id === org.manager_user_id);
      const prefix = org.parent_id ? "　" : "";
      const count = state.employees.filter((employee) => Number(employee.org_id) === org.id).length;
      return `<div class="org-item">
        <div><strong>${prefix}${escapeHtml(org.org_name)}</strong><span>${escapeHtml(manager?.name || "未设置负责人")}</span></div>
        <div class="org-actions">
          <em>${count} 人</em>
          <button class="secondary compact-action" type="button" data-org-edit="${org.id}">编辑</button>
          <button class="danger compact-action" type="button" data-org-delete="${org.id}">删除</button>
        </div>
      </div>`;
    })
    .join("") || `<div class="empty-state">没有匹配的部门</div>`;
  bindOrganizationActions();
}

function organizationEditDrawer(org) {
  const managerOptions = managementOptions(org.id, org.manager_user_id);
  const parentOptions = state.organizations
    .filter((item) => item.id !== org.id && item.org_type === "company")
    .map((item) => `<option value="${item.id}" ${Number(org.parent_id) === item.id ? "selected" : ""}>${escapeHtml(item.org_name)}</option>`)
    .join("");
  return `<div class="org-drawer">
    <div class="org-edit-fields">
      <label>部门名称<input data-org-field="orgName" name="orgName" autocomplete="off" aria-label="部门名称" value="${escapeHtml(org.org_name || "")}" placeholder="部门名称…"></label>
      <label>部门类型<select data-org-field="orgType" name="orgType" aria-label="部门类型">
        <option value="department" ${org.org_type !== "company" ? "selected" : ""}>部门</option>
        <option value="company" ${org.org_type === "company" ? "selected" : ""}>公司</option>
      </select></label>
      <label>上级部门<select data-org-field="parentId" name="parentId" aria-label="上级部门"><option value="">无上级</option>${parentOptions}</select></label>
      <label>部门负责人<select data-org-field="managerUserId" name="managerUserId" aria-label="部门负责人"><option value="">未设置负责人</option>${managerOptions}</select></label>
    </div>
  </div>`;
}

function bindOrganizationActions() {
  document.querySelectorAll("[data-org-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingOrgId = Number(button.dataset.orgEdit);
      renderOrganizations();
    });
  });
  document.querySelectorAll("[data-org-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingOrgId = null;
      state.organizations = state.organizations.filter((org) => org.id !== 0);
      renderOrganizations();
    });
  });
  document.querySelectorAll("[data-org-save]").forEach((button) => {
    button.addEventListener("click", saveOrganization);
  });
  document.querySelectorAll("[data-org-delete]").forEach((button) => {
    button.addEventListener("click", deleteOrganization);
  });
}

function renderEmployees() {
  const modeInput = document.querySelector(`input[name="employeeMode"][value="${state.employeeTab}"]`);
  if (modeInput) modeInput.checked = true;
  $("#newEmployee").textContent = state.employeeTab === "management" ? "新增管理人员" : "新增员工";
  $("#deleteEmployeeToolbar").textContent = state.employeeTab === "management" ? "删除管理人员" : "删除员工";
  const renderRows = (items) => items.map((item) => {
    const editing = state.editingEmployeeId === item.id;
    if (editing) return employeeEditRow(item);
    return `<tr class="${state.selectedEmployeeId === item.id ? "selected-row" : ""}" data-employee-row="${item.id}">
      <td><div class="row-actions"><button class="secondary compact-action" type="button" data-employee-edit="${item.id}">编辑</button></div></td>
      <td>${item.employee_no || "-"}</td>
      <td>${item.name}</td>
      <td>${item.org_name || item.department}</td>
      <td>${item.position_name || "-"}</td>
      <td>${item.contract_type === "service" ? "劳务合同" : "劳动合同"}</td>
      <td>${employeeSalaryText(item)}</td>
      <td>${employeePeriodText(item)}</td>
      <td>${employeeTenureText(item)}</td>
      <td>${item.manager_name || "-"}</td>
      <td><span class="status">${item.status || "active"}</span></td>
    </tr>`;
  }).join("");
  const visiblePeople = state.employeeTab === "management"
    ? state.employees.filter(isManagement)
    : state.employees.filter((item) => !isManagement(item));
  if (!visiblePeople.some((item) => item.id === state.selectedEmployeeId)) state.selectedEmployeeId = null;
  const emptyText = state.employeeTab === "management" ? "暂无管理人员" : "暂无员工";
  $("#employeeTable").innerHTML = `
    <thead><tr><th>操作</th><th>员工编号</th><th>姓名</th><th>部门</th><th>岗位</th><th>合同</th><th>薪酬</th><th>聘用期</th><th>工龄</th><th>直属领导</th><th>状态</th></tr></thead>
    <tbody>${renderRows(visiblePeople) || `<tr><td colspan="11" class="empty-table-cell">${emptyText}</td></tr>`}</tbody>`;
  bindEmployeeActions();
  updateEmployeeToolbar();
  renderOrganizations();
  renderEmployeeReminders();
}

function updateEmployeeToolbar() {
  const button = $("#deleteEmployeeToolbar");
  const selected = state.employees.find((item) => item.id === state.selectedEmployeeId);
  const disabled = !selected || selected.id === state.currentUser?.id || state.editingEmployeeId !== null;
  button.disabled = disabled;
  button.title = selected
    ? selected.id === state.currentUser?.id
      ? "不能删除当前登录账号"
      : `删除 ${selected.name}`
    : "先在列表中选中一名人员";
}

function renderEmployeeReminders() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const reminders = [];
  state.employees.forEach((item) => {
    if (item.id === 0) return;
    const name = item.name || item.employee_no || "未命名员工";
    if (!item.manager_user_id) {
      reminders.push({ level: "warn", title: `${name} 未绑定直属领导`, meta: item.org_name || item.department || "未分配部门" });
    }
    if (item.contract_type === "service" && !Number(item.daily_wage || 0)) {
      reminders.push({ level: "danger", title: `${name} 缺少劳务日薪`, meta: "薪酬基础待补全" });
    }
    if (item.contract_type !== "service" && !Number(item.monthly_salary || 0)) {
      reminders.push({ level: "danger", title: `${name} 缺少劳动月薪`, meta: "薪酬基础待补全" });
    }
    if (item.contract_end) {
      const endDate = parseLocalDate(item.contract_end);
      const daysLeft = Math.ceil((endDate - today) / 86400000);
      if (daysLeft < 0) {
        reminders.push({ level: "danger", title: `${name} 合同已到期`, meta: item.contract_end });
      } else if (daysLeft <= 30) {
        reminders.push({ level: "warn", title: `${name} 合同 ${daysLeft} 天后到期`, meta: item.contract_end });
      }
    }
  });

  const count = reminders.length;
  $("#reminderInfoBtn").textContent = count ? `提醒 (${count})` : "提醒";
  $("#employeeReminders").innerHTML = reminders.slice(0, 8).map((item) => `
    <div class="reminder-item ${item.level}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.meta)}</span>
    </div>
  `).join("") || `<div class="empty-state">暂无提醒事项</div>`;
}

function employeeEditRow(item) {
  const orgOptions = state.organizations
    .filter((org) => org.org_type !== "company")
    .map((org) => `<option value="${org.id}" ${Number(item.org_id) === org.id ? "selected" : ""}>${org.org_name}</option>`)
    .join("");
  const managerOptions = managementOptions(item.org_id, item.manager_user_id, item.id);
  const hireDate = item.hire_date || item.contract_start || "";
  const contractMonths = monthsBetween(hireDate, item.contract_end);
  const salaryField = item.contract_type === "service"
    ? `<input class="employee-input salary" data-field="dailyWage" name="dailyWage" inputmode="decimal" aria-label="日薪" placeholder="日薪…" value="${item.daily_wage || ""}">`
    : `<input class="employee-input salary" data-field="monthlySalary" name="monthlySalary" inputmode="decimal" aria-label="月薪" placeholder="月薪…" value="${item.monthly_salary || ""}">`;
  return `<tr data-employee-role="${item.role || "employee"}">
    <td><div class="row-actions"><button class="primary compact-action" type="button" data-employee-save="${item.id || ""}" data-employee-role="${item.role || "employee"}">保存</button><button class="secondary compact-action" type="button" data-employee-cancel>取消</button></div></td>
    <td><input class="employee-input" data-field="employeeNo" name="employeeNo" autocomplete="off" aria-label="员工编号" value="${escapeHtml(item.employee_no || "")}"></td>
    <td><input class="employee-input" data-field="name" name="employeeName" autocomplete="off" aria-label="姓名" value="${escapeHtml(item.name || "")}"></td>
    <td><select class="employee-select" data-field="orgId" data-org-picker name="orgId" aria-label="部门">${orgOptions}</select></td>
    <td><input class="employee-input" data-field="positionName" name="positionName" autocomplete="off" aria-label="岗位" value="${escapeHtml(item.position_name || "")}"></td>
    <td><select class="employee-select" data-field="contractType" data-contract-toggle name="contractType" aria-label="合同类型"><option value="labor" ${item.contract_type !== "service" ? "selected" : ""}>劳动合同</option><option value="service" ${item.contract_type === "service" ? "selected" : ""}>劳务合同</option></select></td>
    <td data-salary-cell>${salaryField}</td>
    <td><div class="period-fields"><input class="employee-input" type="date" data-field="hireDate" name="hireDate" autocomplete="off" aria-label="入职日期" value="${hireDate}"><input class="employee-input salary" data-field="contractMonths" name="contractMonths" inputmode="numeric" aria-label="合同时长（月）" value="${contractMonths}" title="合同时长（月）"></div></td>
    <td>${employeeTenureText(item)}</td>
    <td><select class="employee-select" data-field="managerUserId" data-manager-picker name="managerUserId" aria-label="直属领导"><option value="">未设置</option>${managerOptions}</select></td>
    <td><select class="employee-select" data-field="status" name="employeeStatus" aria-label="员工状态"><option value="active" ${item.status !== "terminated" ? "selected" : ""}>在职</option><option value="terminated" ${item.status === "terminated" ? "selected" : ""}>解聘</option></select></td>
  </tr>`;
}

function bindEmployeeActions() {
  document.querySelectorAll("[data-employee-row]").forEach((row) => {
    row.addEventListener("click", (event) => {
      if (event.target.closest("button, input, select, textarea, a")) return;
      state.selectedEmployeeId = Number(row.dataset.employeeRow);
      renderEmployees();
    });
  });
  document.querySelectorAll("[data-employee-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.employeeEdit);
      state.selectedEmployeeId = id;
      state.editingEmployeeId = id;
      renderEmployees();
    });
  });
  document.querySelectorAll("[data-employee-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingEmployeeId = null;
      renderEmployees();
    });
  });
  document.querySelectorAll("[data-employee-save]").forEach((button) => {
    button.addEventListener("click", saveEmployee);
  });
  document.querySelectorAll("[data-contract-toggle]").forEach((select) => {
    select.addEventListener("change", () => {
      const cell = select.closest("tr").querySelector("[data-salary-cell]");
      cell.innerHTML = select.value === "service"
        ? `<input class="employee-input salary" data-field="dailyWage" name="dailyWage" inputmode="decimal" aria-label="日薪" placeholder="日薪…">`
        : `<input class="employee-input salary" data-field="monthlySalary" name="monthlySalary" inputmode="decimal" aria-label="月薪" placeholder="月薪…">`;
    });
  });
  document.querySelectorAll("[data-org-picker]").forEach((select) => {
    select.addEventListener("change", () => {
      const row = select.closest("tr");
      const saveButton = row.querySelector("[data-employee-save]");
      const managerSelect = row.querySelector("[data-manager-picker]");
      const editingId = Number(saveButton?.dataset.employeeSave) || 0;
      managerSelect.innerHTML = `<option value="">未设置</option>${managementOptions(select.value, "", editingId)}`;
    });
  });
}

function newOrganization() {
  const company = state.organizations.find((org) => org.org_type === "company");
  const temp = {
    id: 0,
    org_name: "",
    org_type: "department",
    parent_id: company?.id || "",
    manager_user_id: managementPeople(null)[0]?.id || "",
  };
  state.organizations = [temp, ...state.organizations.filter((org) => org.id !== 0)];
  state.editingOrgId = 0;
  renderOrganizations();
}

function newEmployeeWithRole(role) {
  const orgId = state.organizations.find((org) => org.org_type !== "company")?.id;
  const temp = {
    id: 0,
    employee_no: "",
    name: "",
    role,
    org_id: orgId,
    position_name: "",
    contract_type: "labor",
    monthly_salary: "",
    daily_wage: "",
    hire_date: isoDate(new Date()),
    contract_start: "",
    contract_end: "",
    manager_user_id: managementPeople(orgId)[0]?.id || "",
    status: "active",
  };
  state.employees = [temp, ...state.employees.filter((item) => item.id !== 0)];
  state.editingEmployeeId = 0;
  state.selectedEmployeeId = null;
  renderEmployees();
}

async function saveEmployee(event) {
  const button = event.currentTarget;
  const row = button.closest("tr");
  await withBusyButton(button, "保存中", async () => {
    try {
      const payload = { id: Number(button.dataset.employeeSave) || null };
      row.querySelectorAll("[data-field]").forEach((field) => {
        payload[field.dataset.field] = field.value;
      });
      if (!payload.name?.trim()) {
        row.querySelector('[data-field="name"]')?.focus();
        toast("请先填写姓名");
        return;
      }
      const current = state.employees.find((item) => item.id === (payload.id ?? state.editingEmployeeId));
      payload.role = button.dataset.employeeRole || row.dataset.employeeRole || current?.role || "employee";
      payload.employmentType = payload.contractType === "service" ? "service" : "labor";
      const result = ensureOk(await api("/api/employees/save", {
        method: "POST",
        body: JSON.stringify(payload),
      }));
      state.employees = result.employees || [];
      syncUsersFromEmployees();
      state.editingEmployeeId = null;
      const saved = payload.id
        ? state.employees.find((item) => item.id === payload.id)
        : state.employees.find((item) => item.employee_no === payload.employeeNo || item.name === payload.name);
      state.selectedEmployeeId = saved?.id || null;
      renderEmployees();
      toast(payload.role === "employee" ? "员工信息已保存" : "管理人员信息已保存");
    } catch (error) {
      toast(error.message);
    }
  });
}

async function deleteSelectedEmployee(event) {
  const id = state.selectedEmployeeId;
  if (!id) {
    toast("请先在列表中选中要删除的人员");
    return;
  }
  const item = state.employees.find((employee) => employee.id === id);
  if (!item) {
    toast("选中的人员不存在，请刷新后重试");
    return;
  }
  if (item.id === state.currentUser?.id) {
    toast("不能删除当前登录账号");
    return;
  }
  if (!window.confirm(`确认删除「${item.name || id}」吗？历史周表会保留。`)) return;
  const button = event.currentTarget;
  await withBusyButton(button, "删除中", async () => {
    try {
      const result = ensureOk(await api("/api/employees/delete", {
        method: "POST",
        body: JSON.stringify({ id }),
      }));
      state.employees = result.employees || [];
      syncUsersFromEmployees();
      if (state.editingEmployeeId === id) state.editingEmployeeId = null;
      state.selectedEmployeeId = null;
      renderEmployees();
      toast("人员已删除");
    } catch (error) {
      toast(error.message);
    }
  });
}

async function saveOrganization(event) {
  const button = event.currentTarget;
  const item = button.closest(".org-edit-item");
  await withBusyButton(button, "保存中", async () => {
    try {
      const payload = { id: Number(button.dataset.orgSave) || null };
      item.querySelectorAll("[data-org-field]").forEach((field) => {
        payload[field.dataset.orgField] = field.value;
      });
      if (!payload.orgName?.trim()) {
        item.querySelector('[data-org-field="orgName"]')?.focus();
        toast("请先填写部门名称");
        return;
      }
      const result = ensureOk(await api("/api/organizations/save", {
        method: "POST",
        body: JSON.stringify(payload),
      }));
      state.organizations = result.organizations || [];
      state.editingOrgId = null;
      await loadEmployees();
      toast("部门信息已保存");
    } catch (error) {
      toast(error.message);
    }
  });
}

async function deleteOrganization(event) {
  const button = event.currentTarget;
  const id = Number(button.dataset.orgDelete);
  const org = state.organizations.find((item) => item.id === id);
  if (!window.confirm(`确认删除部门「${org?.org_name || id}」吗？`)) return;
  await withBusyButton(button, "删除中", async () => {
    try {
      const result = ensureOk(await api("/api/organizations/delete", {
        method: "POST",
        body: JSON.stringify({ id }),
      }));
      state.organizations = result.organizations || [];
      if (state.editingOrgId === id) state.editingOrgId = null;
      await loadEmployees();
      toast("部门已删除");
    } catch (error) {
      toast(error.message);
    }
  });
}

function renderReview() {
  const modeInput = document.querySelector(`input[name="approvalMode"][value="${state.approvalTab}"]`);
  if (modeInput) modeInput.checked = true;
  document.querySelectorAll("[data-approval-tab]").forEach((option) => {
    const active = option.dataset.approvalTab === state.approvalTab;
    option.setAttribute("aria-selected", active ? "true" : "false");
  });
  const reviewedMode = state.approvalTab === "reviewed";
  $("#approvalPanelHint").textContent = reviewedMode ? "复查已处理周表和加班 OT" : "处理待审批周表和加班 OT";
  $("#timesheetApprovalHint").textContent = reviewedMode ? "已审批复查" : "待主管审核";
  $("#otApprovalHint").textContent = reviewedMode ? "已处理记录" : "待处理";

  const timesheets = reviewedMode ? state.approvalTasks?.reviewed || [] : state.approvalTasks?.timesheets || [];
  const rows = timesheets.map((item) => {
    if (reviewedMode) {
      return `<tr class="review-row" data-review-detail="${item.timesheet_id}">
        <td>${item.name}</td>
      <td>${item.department}</td>
      <td><span class="status ${item.status}">${statusText[item.status] || item.status}</span></td>
      <td>${Number(item.total_hours).toFixed(2)}</td>
      <td>${item.review_comment || "-"}</td>
      <td>
        <button class="secondary compact-action" type="button" data-review-open="${item.timesheet_id}">查看</button>
        <button class="danger compact-action" type="button" data-reopen="${item.timesheet_id}">退回重开</button>
      </td>
    </tr>`;
    }
    return `<tr class="review-row" data-review-detail="${item.timesheet_id}">
      <td>${item.name}</td>
      <td>${item.department}</td>
      <td><span class="status ${item.status || "draft"}">${statusText[item.status] || "未填写"}</span></td>
      <td>${Number(item.total_hours).toFixed(2)}</td>
      <td>
        <button class="secondary compact-action" type="button" data-review-open="${item.timesheet_id}">查看</button>
        <button class="primary compact-action" type="button" data-approve="${item.timesheet_id}">通过</button>
        <button class="danger compact-action" type="button" data-reject="${item.timesheet_id}">退回</button>
      </td>
    </tr>`;
  });
  const timesheetHead = reviewedMode
    ? "<thead><tr><th>员工</th><th>部门</th><th>结果</th><th>本周工日</th><th>意见</th><th>操作</th></tr></thead>"
    : "<thead><tr><th>员工</th><th>部门</th><th>状态</th><th>本周工日</th><th>操作</th></tr></thead>";
  const timesheetEmpty = reviewedMode
    ? `<tr><td colspan="6">暂无已审核周表</td></tr>`
    : `<tr><td colspan="5">暂无待审核周表</td></tr>`;
  $("#reviewTable").innerHTML = `${timesheetHead}<tbody>${rows.join("") || timesheetEmpty}</tbody>`;
  document.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => reviewAction(button.dataset.approve, "approve"));
  });
  document.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => {
      const comment = window.prompt("请输入退回原因", "请补充项目工作内容备注");
      if (comment !== null) reviewAction(button.dataset.reject, "reject", comment);
    });
  });
  document.querySelectorAll("[data-reopen]").forEach((button) => {
    button.addEventListener("click", () => {
      const comment = window.prompt("请输入退回重开原因", "审批后复查退回，请重新调整周表");
      if (comment !== null) reviewAction(button.dataset.reopen, "reopen", comment);
    });
  });
  document.querySelectorAll("[data-review-open]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      showReviewDrawer(button.dataset.reviewOpen);
    });
  });
  document.querySelectorAll("[data-review-detail]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      showReviewDrawer(row.dataset.reviewDetail);
    });
  });
  renderOtApproval();
}

function renderOtApproval() {
  const reviewedMode = state.approvalTab === "reviewed";
  const items = reviewedMode ? state.approvalTasks?.overtimeReviewed || [] : state.otPending || [];
  const rows = items.map((item) => {
    if (reviewedMode) {
      return `<tr>
        <td>${item.user_name}</td>
        <td>${item.work_date}</td>
        <td>${Number(item.overtime_hours).toFixed(1)}</td>
        <td><span class="status ${item.status}">${statusText[item.status] || item.status}</span></td>
        <td>${item.reject_comment || item.reason || "-"}</td>
      </tr>`;
    }
    return `<tr>
      <td>${item.user_name}</td>
      <td>${item.work_date}</td>
      <td>${Number(item.overtime_hours).toFixed(1)}</td>
      <td>${item.reason || "-"}</td>
      <td>
        <button class="primary" type="button" data-ot-approve="${item.id}">通过</button>
        <button class="danger" type="button" data-ot-reject="${item.id}">退回</button>
      </td>
    </tr>`;
  });
  const head = reviewedMode
    ? "<thead><tr><th>员工</th><th>日期</th><th>小时</th><th>结果</th><th>备注</th></tr></thead>"
    : "<thead><tr><th>员工</th><th>日期</th><th>小时</th><th>原因</th><th>操作</th></tr></thead>";
  const empty = reviewedMode
    ? `<tr><td colspan="5">暂无已审核 OT</td></tr>`
    : `<tr><td colspan="5">暂无待审核 OT</td></tr>`;
  $("#otTable").innerHTML = `${head}<tbody>${rows.join("") || empty}</tbody>`;
  document.querySelectorAll("[data-ot-approve]").forEach((button) => {
    button.addEventListener("click", () => overtimeAction(button.dataset.otApprove, "approved"));
  });
  document.querySelectorAll("[data-ot-reject]").forEach((button) => {
    button.addEventListener("click", () => {
      const comment = window.prompt("请输入退回原因", "请补充加班原因");
      if (comment !== null) overtimeAction(button.dataset.otReject, "rejected", comment);
    });
  });
}

async function overtimeAction(id, status, comment = "") {
  try {
    ensureOk(await api("/api/overtime/action", {
      method: "POST",
      body: JSON.stringify({ id: Number(id), status, comment }),
    }));
    await loadReport();
    toast(status === "approved" ? "OT 已通过" : "OT 已退回");
  } catch (error) {
    toast(error.message);
  }
}

async function showReviewDrawer(timesheetId) {
  const drawer = $("#reviewDrawer");
  if (!timesheetId) {
    toast("周表编号缺失，无法查看详情");
    return;
  }
  try {
    const sheet = await api(`/api/timesheet-detail?timesheetId=${encodeURIComponent(timesheetId)}`);
    const weekEnd = addDays(sheet.week_start_date, 6);
    const dayLabels = sheet.days.map((d) => d.slice(5));
    const projects = [...new Set(sheet.entries.map((e) => e.project_name))];
    const entriesByProject = projects.map((pname) => ({
      name: pname,
      code: sheet.entries.find((e) => e.project_name === pname).project_code,
      days: sheet.days.map((d) => {
        const entry = sheet.entries.find((e) => e.project_name === pname && e.work_date === d);
        return entry ? Number(entry.hours).toFixed(2) : "";
      }),
    }));
    const dailyTotals = sheet.days.map((d) => {
      const dayEntries = sheet.entries.filter((e) => e.work_date === d);
      const sum = dayEntries.reduce((acc, e) => acc + Number(e.hours), 0);
      return sum > 0 ? sum.toFixed(2) : "";
    });
    const otByDay = {};
    (sheet.overtime || []).forEach((ot) => {
      otByDay[ot.work_date] = Number(ot.overtime_hours).toFixed(1);
    });

    const headerRows = `<tr><th></th>${dayLabels.map((d) => `<th>${d}</th>`).join("")}<th>合计</th></tr>`;
    const projectRows = entriesByProject.map((p) =>
      `<tr><td>${escapeHtml(p.code)} ${escapeHtml(p.name)}</td>${sheet.days.map((d, i) => `<td>${p.days[i]}</td>`).join("")}<td></td></tr>`
    ).join("");
    const grandTotal = sheet.entries.reduce((acc, e) => acc + Number(e.hours), 0).toFixed(2);
    const totalRow = `<tr class="review-drawer-subtotal"><td>每日合计</td>${dailyTotals.map((v) => `<td>${v}</td>`).join("")}<td>${grandTotal}</td></tr>`;
    const otRow = `<tr class="review-drawer-ot"><td>加班 (h)</td>${sheet.days.map((d) => `<td>${otByDay[d] || ""}</td>`).join("")}<td></td></tr>`;

    drawer.innerHTML = `
      <div class="review-drawer-head">
        <div>
          <strong>${escapeHtml(sheet.user_name)} · ${escapeHtml(sheet.department)}</strong>
          <span>${sheet.week_start_date} 至 ${weekEnd} · ${statusText[sheet.status] || sheet.status}</span>
        </div>
        <button class="icon-btn" type="button" id="closeReviewDrawer" aria-label="关闭">x</button>
      </div>
      <div class="review-drawer-body">
        <div class="table-wrap compact-wrap">
          <table class="report-table compact-table review-drawer-table">
            <thead>${headerRows}</thead>
            <tbody>${projectRows}${totalRow}${otRow}</tbody>
          </table>
        </div>
      </div>
      ${sheet.remark ? `<div class="review-drawer-remark">备注：${escapeHtml(sheet.remark)}</div>` : ""}
    `;
    drawer.hidden = false;
    $("#closeReviewDrawer").addEventListener("click", () => {
      drawer.hidden = true;
    });
    drawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    toast(error.message);
  }
}

async function reviewAction(timesheetId, action, comment = "") {
  try {
    const result = await api("/api/timesheet/action", {
      method: "POST",
      body: JSON.stringify({ timesheetId: Number(timesheetId), action, comment }),
    });
    if (!result.ok) return toast(result.message);
    if (state.sheet && result.timesheet.id === state.sheet.id) {
      state.sheet = result.timesheet;
      state.rows = normalizeRows(result.timesheet.entries);
      state.overtime = normalizeOvertime(result.timesheet.overtime || []);
      state.sheetDirty = false;
      renderSheet();
    }
    await loadReport();
    const messages = {
      approve: "周表已通过",
      reject: "周表已退回",
      reopen: "周表已退回重开",
    };
    toast(messages[action] || "周表状态已更新");
  } catch (error) {
    toast(error.message);
  }
}

function renderReport() {
  const modeInput = document.querySelector(`input[name="reportMode"][value="${state.reportTab}"]`);
  if (modeInput) modeInput.checked = true;
  const isLabor = state.reportTab === "labor";
  $("#newProject").hidden = isLabor;
  $("#exportCsv").hidden = !isLabor;
  $("#reportPeriodRow").hidden = !isLabor;
  $("#projectDrawer").hidden = true;

  if (!isLabor) {
    renderProjectBase();
    return;
  }

  if (!state.report) return;
  const projects = state.report.projects || [];
  const employees = state.report.employees || [];
  const projectDays = projects.reduce((sum, item) => sum + Number(item.total_hours), 0);
  $("#metricPeople").textContent = employees.filter((item) => Number(item.total_hours) > 0).length;
  $("#metricHours").textContent = projectDays.toFixed(2);
  $("#metricProjects").textContent = projects.length;
  const max = Math.max(...projects.map((item) => Number(item.total_hours)), 1);
  const rows = projects.map((item) => {
    const width = Math.round((Number(item.total_hours) / max) * 100);
    return `<tr class="project-row" data-project-expand="${item.id || item.code}">
      <td>${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${item.people_count}</td>
      <td>${Number(item.total_hours).toFixed(2)}</td>
      <td><div class="bar"><span style="width:${width}%"></span></div></td>
      <td>
        <button class="secondary compact-action" type="button" data-project-detail="${item.id || item.code}">详情</button>
        <button class="secondary compact-action" type="button" data-project-export="${item.id || item.code}">导出</button>
      </td>
    </tr>`;
  });
  $("#projectReportTable").innerHTML = `<thead><tr><th>项目编号</th><th>项目名称</th><th>投入人数</th><th>总工日</th><th>占比</th><th>操作</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="6">暂无项目数据</td></tr>`}</tbody>`;

  document.querySelectorAll("[data-project-expand]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      showProjectDrawer(row.dataset.projectExpand);
    });
  });
  document.querySelectorAll("[data-project-detail]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showProjectDrawer(btn.dataset.projectDetail);
    });
  });
  document.querySelectorAll("[data-project-export]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      exportSingleProject(btn.dataset.projectExport);
    });
  });
}

function renderProjectBase() {
  const rows = state.projectBase.map((item) => {
    const editing = state.editingProjectId === item.id;
    if (editing) {
      return `<tr>
        <td><input class="employee-input" data-project-field="code" value="${escapeHtml(item.code || "")}"></td>
        <td><input class="employee-input" data-project-field="name" value="${escapeHtml(item.name || "")}"></td>
        <td><input class="employee-input salary" data-project-field="contractAmount" inputmode="decimal" value="${item.contract_amount || ""}"></td>
        <td><input class="employee-input salary" data-project-field="receivedAmount" inputmode="decimal" value="${item.received_amount || ""}"></td>
        <td>${formatMoney(Number(item.contract_amount || 0) - Number(item.received_amount || 0))}</td>
        <td><button class="primary compact-action" type="button" data-project-save="${item.id}">保存</button><button class="secondary compact-action" type="button" data-project-cancel>取消</button></td>
      </tr>`;
    }
    return `<tr>
      <td>${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${formatMoney(item.contract_amount)}</td>
      <td>${formatMoney(item.received_amount)}</td>
      <td>${formatMoney(item.receivable_amount)}</td>
      <td>
        <button class="secondary compact-action" type="button" data-project-edit="${item.id}">编辑</button>
        <button class="danger compact-action" type="button" data-project-delete="${item.id}">删除</button>
      </td>
    </tr>`;
  });
  $("#projectReportTable").innerHTML = `<thead><tr><th>项目编号</th><th>项目名称</th><th>合同额</th><th>已回款</th><th>待回款</th><th>操作</th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="6">暂无项目</td></tr>`}</tbody>`;
  document.querySelectorAll("[data-project-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingProjectId = Number(button.dataset.projectEdit);
      renderReport();
    });
  });
  document.querySelectorAll("[data-project-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingProjectId = null;
      state.projectBase = state.projectBase.filter((item) => item.id !== 0);
      renderReport();
    });
  });
  document.querySelectorAll("[data-project-save]").forEach((button) => {
    button.addEventListener("click", () => saveProject(button));
  });
  document.querySelectorAll("[data-project-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteProject(button.dataset.projectDelete));
  });
}

function renderDashboard() {
  if (!state.dashboard) return;
  const rows = state.dashboard.projects || [];
  const totals = rows.reduce((acc, item) => {
    acc.contract += Number(item.contract_amount || 0);
    acc.received += Number(item.received_amount || 0);
    acc.receivable += Number(item.receivable_amount || 0);
    acc.laborCost += Number(item.labor_cost || 0);
    return acc;
  }, { contract: 0, received: 0, receivable: 0, laborCost: 0 });
  $("#metricContract").textContent = formatMoney(totals.contract);
  $("#metricReceived").textContent = formatMoney(totals.received);
  $("#metricReceivable").textContent = formatMoney(totals.receivable);
  $("#metricLaborCost").textContent = formatMoney(totals.laborCost);
  $("#projectDashboardTable").innerHTML = `<thead><tr><th>项目编号</th><th>项目名称</th><th>合同额</th><th>已回款</th><th>待回款</th><th>本周工日</th><th>人力成本</th><th>毛利</th><th>KPI</th></tr></thead><tbody>${rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${formatMoney(item.contract_amount)}</td>
      <td>${formatMoney(item.received_amount)}</td>
      <td>${formatMoney(item.receivable_amount)}</td>
      <td>${Number(item.labor_days || 0).toFixed(2)}</td>
      <td>${formatMoney(item.labor_cost)}</td>
      <td>${formatMoney(item.gross_profit)}</td>
      <td>${Number(item.gross_margin || 0).toFixed(1)}%</td>
    </tr>`).join("") || `<tr><td colspan="9">暂无项目数据</td></tr>`}</tbody>`;
}

function newProject() {
  state.reportTab = "projects";
  state.editingProjectId = 0;
  state.projectBase = [{ id: 0, code: "", name: "", contract_amount: 0, received_amount: 0 }, ...state.projectBase.filter((item) => item.id !== 0)];
  renderReport();
}

async function saveProject(button) {
  const row = button.closest("tr");
  const rawId = Number(button.dataset.projectSave);
  const payload = { id: rawId || null };
  row.querySelectorAll("[data-project-field]").forEach((field) => {
    payload[field.dataset.projectField] = field.value;
  });
  if (!payload.code?.trim() || !payload.name?.trim()) {
    toast("请填写项目编号和名称");
    return;
  }
  try {
    await withBusyButton(button, "保存中", async () => {
      const result = ensureOk(await api("/api/projects/save", {
        method: "POST",
        body: JSON.stringify(payload),
      }));
      state.projectBase = result.projects || [];
      state.projects = state.projectBase;
      state.editingProjectId = null;
      await loadReport();
      toast("项目基础数据已保存");
    });
  } catch (error) {
    toast(error.message);
  }
}

async function showProjectDrawer(projectId) {
  const drawer = $("#projectDrawer");
  if (!projectId) { toast("项目ID缺失"); return; }
  try {
    const employees = await api(`/api/project-detail?projectId=${encodeURIComponent(projectId)}&startDate=${encodeURIComponent(state.reportStartDate)}&endDate=${encodeURIComponent(state.reportEndDate)}`);
    const project = (state.report.projects || []).find((p) => String(p.id || p.code) === String(projectId));
    const totalHours = employees.reduce((s, e) => s + Number(e.total_hours), 0);
    const rows = employees.map((e) => `<tr>
      <td>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.department || "")}</td>
      <td>${Number(e.total_hours).toFixed(2)}</td>
      <td>${e.work_days}</td>
    </tr>`);
    const totalRow = `<tr class="review-drawer-subtotal"><td>合计</td><td></td><td>${totalHours.toFixed(2)}</td><td></td></tr>`;

    drawer.innerHTML = `
      <div class="review-drawer-head">
        <div>
          <strong>${escapeHtml(project?.name || "")} · 员工工日明细</strong>
          <span>${state.reportStartDate} 至 ${state.reportEndDate}</span>
        </div>
        <button class="icon-btn" type="button" id="closeProjectDrawer" aria-label="关闭">x</button>
      </div>
      <div class="review-drawer-body">
        <div class="table-wrap compact-wrap">
          <table class="report-table compact-table review-drawer-table">
            <thead><tr><th>姓名</th><th>部门</th><th>工日</th><th>工作天数</th></tr></thead>
            <tbody>${rows.join("")}${totalRow}</tbody>
          </table>
        </div>
      </div>
    `;
    drawer.hidden = false;
    $("#closeProjectDrawer").addEventListener("click", () => { drawer.hidden = true; });
    drawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    toast(error.message);
  }
}

async function deleteProject(projectId) {
  if (!confirm("确定要删除该项目吗？")) return;
  try {
    const result = await api("/api/projects/delete", {
      method: "POST",
      body: JSON.stringify({ id: Number(projectId) }),
    });
    if (!result.ok) return toast(result.message);
    state.projectBase = result.projects || [];
    state.projects = state.projectBase;
    state.editingProjectId = null;
    renderReport();
    toast("项目已删除");
  } catch (error) {
    toast(error.message);
  }
}

function exportSingleProject(projectId) {
  const employeesResult = state.report.employees.filter((e) => {
    return true;
  });
  const project = (state.report.projects || []).find((p) => String(p.id || p.code) === String(projectId));
  if (!project) { toast("项目不存在"); return; }
  const lines = [["员工姓名", "部门", "工日"]];
  const filename = `${state.reportStartDate}-${project.code || projectId}-工日明细.csv`;
  api(`/api/project-detail?projectId=${encodeURIComponent(projectId)}&startDate=${encodeURIComponent(state.reportStartDate)}&endDate=${encodeURIComponent(state.reportEndDate)}`)
    .then((employees) => {
      employees.forEach((e) => lines.push([e.name, e.department || "", Number(e.total_hours).toFixed(2)]));
      const csv = lines.map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
      const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    })
    .catch((error) => toast(error.message));
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function exportCsv() {
  const lines = [["项目编号", "项目名称", "投入人数", "总工日"]];
  state.report.projects.forEach((item) => lines.push([item.code, item.name, item.people_count, Number(item.total_hours).toFixed(2)]));
  const csv = lines.map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.reportStartDate || state.report.startDate}-项目工日汇总.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

boot().catch((error) => {
  console.error(error);
  toast("页面加载失败，请查看服务日志");
});
