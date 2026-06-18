import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useEmployees,
  useOrganizations,
  useSaveEmployee,
  useDeleteEmployee,
} from "@/hooks/useEmployees";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SegmentedPill } from "@/components/ui/segmented-pill";
import { roleText } from "@/lib/constants";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { EmployeeTable } from "@/components/employees/EmployeeTable";
import { OrganizationPanel } from "@/components/employees/OrganizationPanel";
import { ReminderFloat } from "@/components/employees/ReminderFloat";
import { PermissionConfigPanel } from "@/components/employees/PermissionConfigPanel";
import { useAuthStore } from "@/stores/authStore";
import { flattenOrgTree, isCostOrganization } from "@/utils/orgTree";
import { isoDate } from "@/utils/dates";
import { EmployeeEditRow, type EmployeeEditData } from "@/components/employees/EmployeeEditRow";
import type { Employee } from "@/types/employee";
import { toast } from "sonner";

type EmployeeSortKey =
  | "employeeNo"
  | "name"
  | "role"
  | "department"
  | "position"
  | "contract"
  | "salary"
  | "hireDate"
  | "tenure"
  | "status";
type SortDirection = "asc" | "desc";
type EmployeeListView = "active" | "terminated";
type EmployeePageTab = "system" | "permissions";

const EMPTY_EDIT_DATA: EmployeeEditData = {
  id: 0,
  employeeNo: "",
  name: "",
  role: "employee",
  orgId: "",
  positionName: "",
  costSpecialty: "",
  contractType: "labor",
  monthlySalary: "",
  dailyWage: "",
  hireDate: isoDate(new Date()),
  contractMonths: "12",
  managerUserId: "",
  status: "active",
};

function inferCostSpecialty(positionName: string): string {
  if (positionName.includes("土建")) return "civil";
  if (positionName.includes("机电")) return "mep";
  return "";
}

function requiresCostSpecialty(role: string): boolean {
  return role === "employee";
}

function employeeSearchText(emp: Employee, orgPath: string) {
  return [
    emp.employee_no,
    emp.name,
    orgPath,
    emp.org_name,
    emp.department,
    emp.position_name,
    roleText[emp.role],
    emp.cost_specialty === "civil" ? "土建" : "",
    emp.cost_specialty === "mep" ? "机电" : "",
    emp.contract_type === "service" ? "劳务合同" : "劳动合同",
    emp.status === "active" ? "在职" : "离职",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function employeeSortValue(emp: Employee, sortKey: EmployeeSortKey) {
  if (sortKey === "employeeNo") return emp.employee_no || "";
  if (sortKey === "name") return emp.name || "";
  if (sortKey === "role") return roleText[emp.role] || emp.role || "";
  if (sortKey === "department") return emp.org_name || emp.department || "";
  if (sortKey === "position") return `${emp.position_name || ""} ${emp.cost_specialty || ""}`;
  if (sortKey === "contract") return emp.contract_type || "";
  if (sortKey === "salary") {
    return String(emp.contract_type === "service" ? Number(emp.daily_wage || 0) : Number(emp.monthly_salary || 0)).padStart(12, "0");
  }
  if (sortKey === "hireDate") return emp.hire_date || "";
  if (sortKey === "tenure") return emp.hire_date || "";
  return emp.status || "";
}

function activeStatus(emp: Employee) {
  return String(emp.status || "").toLowerCase() === "terminated"
    ? "terminated"
    : "active";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nextNameWithSuffix(name: string, employees: Employee[]) {
  const trimmed = name.trim();
  if (!trimmed) return name;
  if (/\d+$/.test(trimmed)) return trimmed;
  const pattern = new RegExp(`^${escapeRegExp(trimmed)}(\\d*)$`);
  let maxSuffix = 0;
  for (const employee of employees) {
    const existing = String(employee.name || "").trim();
    const match = existing.match(pattern);
    if (!match) continue;
    maxSuffix = Math.max(maxSuffix, match[1] ? Number(match[1]) : 1);
  }
  return maxSuffix > 0 ? `${trimmed}${maxSuffix + 1}` : trimmed;
}

export default function EmployeesPage() {
  const { user: currentUser, canAccess } = useAuthStore();
  const navigate = useNavigate();
  const canReadSystem = canAccess("system_management", "read");
  const canWriteSystem = canAccess("system_management", "write");
  const canReadPermissions = canAccess("permission_config", "read");
  const canWritePermissions = canAccess("permission_config", "write");

  useEffect(() => {
    if (!canReadSystem && !canReadPermissions) navigate("/timesheet", { replace: true });
  }, [canReadPermissions, canReadSystem, navigate]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<EmployeeEditData | null>(null);
  const [autoEmployeeNo, setAutoEmployeeNo] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [employeeListView, setEmployeeListView] = useState<EmployeeListView>("active");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<EmployeeSortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [employeePageTab, setEmployeePageTab] = useState<EmployeePageTab>(
    canReadSystem ? "system" : "permissions",
  );

  useEffect(() => {
    if (employeePageTab === "system" && !canReadSystem) {
      setEmployeePageTab("permissions");
    }
    if (employeePageTab === "permissions" && !canReadPermissions) {
      setEmployeePageTab("system");
    }
  }, [canReadPermissions, canReadSystem, employeePageTab]);

  const {
    data: employees = [],
    isLoading,
    isError,
    refetch,
  } = useEmployees();
  const { data: orgs = [] } = useOrganizations();
  const saveEmployee = useSaveEmployee();
  const deleteEmployee = useDeleteEmployee();

  const managedOrgIds = useMemo(() => {
    const ids = new Set<number>();
    if (!currentUser) return ids;
    const byParent = new Map<number, number[]>();
    orgs.forEach((org) => {
      if (org.parent_id) {
        const list = byParent.get(org.parent_id) || [];
        list.push(org.id);
        byParent.set(org.parent_id, list);
      }
    });
    const queue = orgs
      .filter((org) => (org.manager_ids || []).includes(currentUser.id))
      .map((org) => org.id);
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || ids.has(id)) continue;
      ids.add(id);
      queue.push(...(byParent.get(id) || []));
    }
    return ids;
  }, [currentUser, orgs]);

  const canEditEmployee = useCallback(
    (_emp: Employee) => canWriteSystem,
    [canWriteSystem],
  );

  const visibleOrgIds = useMemo(() => {
    if (canReadSystem) return new Set(orgs.map((org) => org.id));
    return managedOrgIds;
  }, [canReadSystem, orgs, managedOrgIds]);

  const visibleEmployees = useMemo(
    () => employees.filter((emp) => canReadSystem || canEditEmployee(emp)),
    [employees, canReadSystem, canEditEmployee],
  );

  const activeEmployees = useMemo(
    () => visibleEmployees.filter((emp) => activeStatus(emp) === "active"),
    [visibleEmployees],
  );

  const terminatedEmployees = useMemo(
    () => visibleEmployees.filter((emp) => activeStatus(emp) === "terminated"),
    [visibleEmployees],
  );

  const listedEmployees = employeeListView === "active" ? activeEmployees : terminatedEmployees;

  const visibleOrgs = useMemo(
    () => orgs.filter((org) => canReadSystem || visibleOrgIds.has(org.id)),
    [orgs, canReadSystem, visibleOrgIds],
  );
  const orgPathById = useMemo(
    () => new Map(flattenOrgTree(orgs).map((org) => [org.id, org.path])),
    [orgs],
  );
  const filteredEmployees = useMemo(() => {
    const keywords = search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const rows = listedEmployees.filter((emp) => {
      if (keywords.length === 0) return true;
      const searchText = employeeSearchText(emp, emp.org_id ? orgPathById.get(Number(emp.org_id)) || "" : "");
      return keywords.every((keyword) => searchText.includes(keyword));
    });
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const left = employeeSortValue(a, sortKey);
      const right = employeeSortValue(b, sortKey);
      const result = left.localeCompare(right, "zh-CN", { numeric: true });
      return sortDirection === "asc" ? result : -result;
    });
  }, [
    orgPathById,
    search,
    sortDirection,
    sortKey,
    listedEmployees,
  ]);

  useEffect(() => {
    if (selectedId && !listedEmployees.some((emp) => emp.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, listedEmployees]);

  useEffect(() => {
    setSelectedId(null);
    setEditingId(null);
    setEditData(null);
    setAutoEmployeeNo(null);
  }, [employeeListView]);

  const initEditData = useCallback(
    (emp: Employee): EmployeeEditData => ({
      id: emp.id,
      employeeNo: emp.employee_no || "",
      name: emp.name || "",
      role: emp.role || "employee",
      orgId: emp.org_id ? String(emp.org_id) : "",
      positionName: emp.position_name || "",
      costSpecialty: emp.cost_specialty || inferCostSpecialty(emp.position_name || ""),
      contractType: emp.contract_type || "labor",
      monthlySalary: emp.monthly_salary || "",
      dailyWage: emp.daily_wage || "",
      hireDate: emp.hire_date || emp.contract_start || "",
      contractMonths: emp.contract_end && emp.hire_date
        ? String(
            Math.max(
              (new Date(emp.contract_end).getFullYear() -
                new Date(emp.hire_date).getFullYear()) *
                12 +
                new Date(emp.contract_end).getMonth() -
                new Date(emp.hire_date).getMonth() +
                1,
              1,
            ),
          )
        : "12",
      managerUserId: emp.manager_user_id ? String(emp.manager_user_id) : "",
      status: emp.status || "active",
    }),
    [],
  );

  const handleEdit = useCallback(
    (id: number) => {
      const emp = visibleEmployees.find((e) => e.id === id);
      if (!emp) return;
      if (!canEditEmployee(emp)) return;
      setSelectedId(id);
      setEditingId(id);
      setEditData(initEditData(emp));
    },
    [visibleEmployees, initEditData, canEditEmployee],
  );

  const handleNew = useCallback(() => {
    const orgId = visibleOrgs.find((o) => o.org_type !== "company")?.id;
    setSelectedId(null);
    setEditingId(0);
    setAutoEmployeeNo(null);
    setEditData({
      ...EMPTY_EDIT_DATA,
      orgId: orgId ? String(orgId) : "",
    });
  }, [visibleOrgs]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditData(null);
    setAutoEmployeeNo(null);
  }, []);

  useEffect(() => {
    if (editingId !== 0 || !editData?.orgId) return;
    if (editData.employeeNo && editData.employeeNo !== autoEmployeeNo) return;

    let cancelled = false;
    api<{ code: string }>(`/api/numbering/employee?orgId=${encodeURIComponent(editData.orgId)}`)
      .then((result) => {
        if (cancelled || !result.code) return;
        setAutoEmployeeNo(result.code);
        setEditData((prev) => {
          if (!prev || prev.id !== 0) return prev;
          if (prev.employeeNo && prev.employeeNo !== autoEmployeeNo) return prev;
          return { ...prev, employeeNo: result.code };
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [autoEmployeeNo, editData?.employeeNo, editData?.orgId, editingId]);

  const applyUniqueNewName = useCallback(
    (name: string) => {
      if (editingId !== 0) return;
      const nextName = nextNameWithSuffix(name, employees);
      if (nextName === name.trim()) return;
      setEditData((prev) => (prev && prev.id === 0 ? { ...prev, name: nextName } : prev));
      toast.info(`检测到重名，已自动调整为 ${nextName}`);
    },
    [editingId, employees],
  );

  const handleReactivate = useCallback(
    async (id: number) => {
      const emp = visibleEmployees.find((e) => e.id === id);
      if (!emp) return;
      try {
        await saveEmployee.mutateAsync({
          id: emp.id,
          employeeNo: emp.employee_no,
          name: emp.name,
          role: emp.role || "employee",
          orgId: emp.org_id,
          positionName: emp.position_name || "",
          costSpecialty: emp.cost_specialty || null,
          contractType: emp.contract_type || "labor",
          monthlySalary: emp.monthly_salary || "0",
          dailyWage: emp.daily_wage || "0",
          hireDate: emp.hire_date || isoDate(new Date()),
          contractMonths: "12",
          managerUserId: emp.manager_user_id,
          status: "active",
          employmentType: emp.employment_type || emp.contract_type || "labor",
        });
        toast.success(`${emp.name} 已重新启用`);
        setEmployeeListView("active");
        setSelectedId(emp.id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "重新启用失败");
      }
    },
    [saveEmployee, visibleEmployees],
  );

  const handleSave = useCallback(async () => {
    if (!editData) return;
    const normalizedName = editingId === 0
      ? nextNameWithSuffix(editData.name, employees)
      : editData.name.trim();
    if (editingId === 0 && normalizedName !== editData.name.trim()) {
      setEditData((prev) => (prev ? { ...prev, name: normalizedName } : prev));
      toast.info(`检测到重名，已自动调整为 ${normalizedName}`);
    }
    if (!editData.name.trim()) {
      toast.error("请先填写姓名");
      return;
    }
    if (
      editData.orgId &&
      requiresCostSpecialty(editData.role) &&
      isCostOrganization(orgs, Number(editData.orgId)) &&
      !editData.costSpecialty
    ) {
      toast.error("成本合约执行人员需要选择土建或机电岗位");
      return;
    }
    const shouldSaveCostSpecialty =
      !!editData.orgId &&
      requiresCostSpecialty(editData.role) &&
      isCostOrganization(orgs, Number(editData.orgId));

    const payload: Record<string, unknown> = {
      id: editData.id || null,
      employeeNo: editData.employeeNo,
      name: normalizedName,
      role: editData.role,
      orgId: editData.orgId ? Number(editData.orgId) : null,
      positionName: editData.positionName,
      costSpecialty: shouldSaveCostSpecialty ? editData.costSpecialty || null : null,
      contractType: editData.contractType,
      monthlySalary: editData.monthlySalary,
      dailyWage: editData.dailyWage,
      hireDate: editData.hireDate,
      contractMonths: parseInt(editData.contractMonths) || 12,
      managerUserId: editData.managerUserId
        ? Number(editData.managerUserId)
        : null,
      status: editData.status,
      employmentType:
        editData.contractType === "service" ? "service" : "labor",
    };

    try {
      const result = await saveEmployee.mutateAsync(payload) as {
        loginName?: string;
        login_name?: string;
        initialPassword?: string;
        initial_password?: string;
      } | undefined;
      const loginName = result?.loginName || result?.login_name;
      const initialPassword = result?.initialPassword || result?.initial_password;
      if (!editData.id && loginName && initialPassword) {
        toast.success("员工已创建", {
          description: `登录名：${loginName}，初始密码：${initialPassword}`,
          duration: 12000,
        });
      } else {
        toast.success("员工信息已保存");
      }
      setEditingId(null);
      setEditData(null);
      setAutoEmployeeNo(null);
      setSelectedId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  }, [editData, editingId, employees, orgs, saveEmployee]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteEmployee.mutateAsync(deleteTarget.id);
      toast.success(`${deleteTarget.name} 已设为离职`);
      if (selectedId === deleteTarget.id) setSelectedId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "设为离职失败");
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteEmployee, selectedId]);

  const handleDelete = useCallback(() => {
    if (!selectedId) {
      toast.error("请先在列表中选中要设为离职的人员");
      return;
    }
    const emp = listedEmployees.find((e) => e.id === selectedId);
    if (!emp) {
      toast.error("选中的人员不存在，请刷新后重试");
      return;
    }
    if (emp.id === currentUser?.id) {
      toast.error("不能将当前登录账号设为离职");
      return;
    }
    setDeleteTarget({ id: emp.id, name: emp.name || String(emp.id) });
  }, [selectedId, listedEmployees, currentUser]);

  const deleteDisabled = !selectedId || editingId != null;
  const editDialogTitle = editingId === 0 ? "新增员工" : "员工配置";
  const editDialogDescription =
    editingId === 0
      ? "填写基础信息后会自动生成登录账号。"
      : "维护员工的部门、权限、合同和薪酬信息。";
  const employeeListSegments = [
    {
      value: "active" as const,
      label: "员工列表",
      meta: employeeListView === "active" ? `${filteredEmployees.length} / ${activeEmployees.length}` : activeEmployees.length,
    },
    {
      value: "terminated" as const,
      label: "离职人员",
      meta: employeeListView === "terminated" ? `${filteredEmployees.length} / ${terminatedEmployees.length}` : terminatedEmployees.length,
    },
  ];
  const employeePageSegments = [
    ...(canReadSystem ? [{ value: "system" as const, label: "系统管理" }] : []),
    ...(canReadPermissions ? [{ value: "permissions" as const, label: "权限配置" }] : []),
  ];
  const handleSort = (key: EmployeeSortKey) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection("asc");
      return;
    }
    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }
    setSortKey(null);
    setSortDirection("asc");
  };

  return (
    <div>
      <div className="mb-4">
        <SegmentedPill
          value={employeePageTab}
          items={employeePageSegments}
          onChange={setEmployeePageTab}
          ariaLabel="员工与组织视图"
        />
      </div>

        {canReadSystem && employeePageTab === "system" && (
            <div className="grid grid-cols-[1.45fr_0.55fr] gap-4 max-[900px]:grid-cols-1">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <SegmentedPill
                    value={employeeListView}
                    items={employeeListSegments}
                    onChange={setEmployeeListView}
                  />
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <ReminderFloat employees={activeEmployees} />
                    <Button variant="outline" size="sm" onClick={() => refetch()}>
                      <RefreshCw className="size-3.5 mr-1" />
                      刷新
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleteDisabled || employeeListView !== "active"}
                      onClick={handleDelete}
                      className={canWriteSystem && employeeListView === "active" ? "" : "hidden"}
                    >
                      <Trash2 className="size-3.5 mr-1" />
                      设为离职
                    </Button>
                    <Button size="sm" onClick={handleNew} className={canWriteSystem && employeeListView === "active" ? "" : "hidden"}>
                      <Plus className="size-3.5 mr-1" />
                      新增员工
                    </Button>
                  </div>
                </div>

                <div className="mb-3 rounded-lg border border-border bg-white p-3">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-9 pl-8 text-sm"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="级联搜索：编号 / 姓名 / 部门路径 / 权限 / 岗位 / 合同 / 专业 / 状态，多个条件用空格分隔"
                    />
                  </label>
                </div>

                {isLoading && (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    加载中...
                  </div>
                )}
                {isError && (
                  <div className="py-10 text-center text-sm text-destructive">
                    加载失败
                  </div>
                )}
                {!isLoading && !isError && (
                  <EmployeeTable
                    employees={filteredEmployees}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onEdit={handleEdit}
                    onReactivate={handleReactivate}
                    canEditEmployee={canEditEmployee}
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                )}
              </div>

              <OrganizationPanel
                employees={activeEmployees}
                canManage={canWriteSystem}
                visibleOrgIds={visibleOrgIds}
              />
            </div>
        )}

        {canReadPermissions && employeePageTab === "permissions" && (
            <PermissionConfigPanel canWrite={canWritePermissions} />
        )}

      <Dialog
        open={editData != null}
        onOpenChange={(open) => {
          if (!open) handleCancelEdit();
        }}
      >
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editDialogTitle}</DialogTitle>
            <DialogDescription>{editDialogDescription}</DialogDescription>
          </DialogHeader>
          {editData && (
            <EmployeeEditRow
              item={editingId === 0 ? null : visibleEmployees.find((emp) => emp.id === editingId) || null}
              data={editData}
              orgs={visibleOrgs}
              employees={employees}
              isNew={editingId === 0}
              canEditRole={canWritePermissions}
              onChange={(update) =>
                setEditData((prev) => {
                  if (!prev) return prev;
                  if (editingId === 0 && update.employeeNo !== undefined) {
                    setAutoEmployeeNo(null);
                  }
                  return { ...prev, ...update };
                })
              }
              onNameBlur={applyUniqueNewName}
              onSave={handleSave}
              onCancel={handleCancelEdit}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认设为离职</AlertDialogTitle>
            <AlertDialogDescription>
              确认将“{deleteTarget?.name}”设为离职吗？历史周表会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
