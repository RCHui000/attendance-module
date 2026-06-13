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
  useEmployees,
  useOrganizations,
  useSaveEmployee,
  useDeleteEmployee,
} from "@/hooks/useEmployees";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { APP_VERSION, roleText } from "@/lib/constants";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { EmployeeTable } from "@/components/employees/EmployeeTable";
import { OrganizationPanel } from "@/components/employees/OrganizationPanel";
import { ReminderFloat } from "@/components/employees/ReminderFloat";
import { PermissionConfigPanel } from "@/components/employees/PermissionConfigPanel";
import { useAuthStore } from "@/stores/authStore";
import { flattenOrgTree, isCostOrganization } from "@/utils/orgTree";
import type { EmployeeEditData } from "@/components/employees/EmployeeEditRow";
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
  hireDate: new Date().toISOString().slice(0, 10),
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
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<EmployeeSortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

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
      .filter((org) => org.manager_user_id === currentUser.id)
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
    const rows = visibleEmployees.filter((emp) => {
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
    visibleEmployees,
  ]);

  useEffect(() => {
    if (selectedId && !visibleEmployees.some((emp) => emp.id === selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, visibleEmployees]);

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
    setEditData({
      ...EMPTY_EDIT_DATA,
      orgId: orgId ? String(orgId) : "",
    });
  }, [visibleOrgs]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditData(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!editData) return;
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
      name: editData.name.trim(),
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
      setSelectedId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  }, [editData, orgs, saveEmployee]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteEmployee.mutateAsync(deleteTarget.id);
      toast.success("已删除「" + deleteTarget.name + "」");
      if (selectedId === deleteTarget.id) setSelectedId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteEmployee, selectedId]);

  const handleDelete = useCallback(() => {
    if (!selectedId) {
      toast.error("请先在列表中选中要删除的人员");
      return;
    }
    const emp = visibleEmployees.find((e) => e.id === selectedId);
    if (!emp) {
      toast.error("选中的人员不存在，请刷新后重试");
      return;
    }
    if (emp.id === currentUser?.id) {
      toast.error("不能删除当前登录账号");
      return;
    }
    setDeleteTarget({ id: emp.id, name: emp.name || String(emp.id) });
  }, [selectedId, visibleEmployees, currentUser]);

  const deleteDisabled = !selectedId || editingId != null;
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
      <div className="mb-4 flex items-start justify-between gap-3 max-[640px]:flex-col">
        <strong className="block text-sm text-foreground">员工与组织架构</strong>
        <Badge
          variant="outline"
          className="h-7 rounded-pill border-border bg-white px-3 text-xs font-bold text-muted-foreground"
        >
          版本 {APP_VERSION}
        </Badge>
      </div>

      <Tabs defaultValue={canReadSystem ? "system" : "permissions"} className="gap-4">
        <TabsList>
          {canReadSystem && <TabsTrigger value="system">系统管理</TabsTrigger>}
          {canReadPermissions && <TabsTrigger value="permissions">权限配置</TabsTrigger>}
        </TabsList>

        {canReadSystem && (
          <TabsContent value="system">
            <div className="grid grid-cols-[1.45fr_0.55fr] gap-4 max-[900px]:grid-cols-1">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <strong className="text-sm">员工列表</strong>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {filteredEmployees.length} / {visibleEmployees.length} 人
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <ReminderFloat employees={visibleEmployees} />
                    <Button variant="outline" size="sm" onClick={() => refetch()}>
                      <RefreshCw className="size-3.5 mr-1" />
                      刷新
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleteDisabled}
                      onClick={handleDelete}
                      className={canWriteSystem ? "" : "hidden"}
                    >
                      <Trash2 className="size-3.5 mr-1" />
                      删除员工
                    </Button>
                    <Button size="sm" onClick={handleNew} className={canWriteSystem ? "" : "hidden"}>
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
                    加载中…
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
                    orgs={visibleOrgs}
                    selectedId={selectedId}
                    editingId={editingId}
                    editData={editData}
                    onSelect={setSelectedId}
                    onEdit={handleEdit}
                    canEditEmployee={canEditEmployee}
              canEditRole={canWritePermissions}
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    onEditChange={(update) =>
                      setEditData((prev) => (prev ? { ...prev, ...update } : prev))
                    }
                    onSave={handleSave}
                    onCancelEdit={handleCancelEdit}
                  />
                )}
              </div>

              <OrganizationPanel
                employees={visibleEmployees}
                canManage={canWriteSystem}
                visibleOrgIds={visibleOrgIds}
              />
            </div>
          </TabsContent>
        )}

        {canReadPermissions && (
          <TabsContent value="permissions">
            <PermissionConfigPanel canWrite={canWritePermissions} />
          </TabsContent>
        )}
      </Tabs>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确认删除「{deleteTarget?.name}」吗？历史周表会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
