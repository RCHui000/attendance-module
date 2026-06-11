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
import { APP_VERSION } from "@/lib/constants";
import { RefreshCw, Plus, Trash2 } from "lucide-react";
import { EmployeeTable } from "@/components/employees/EmployeeTable";
import { OrganizationPanel } from "@/components/employees/OrganizationPanel";
import { ReminderFloat } from "@/components/employees/ReminderFloat";
import { useAuthStore } from "@/stores/authStore";
import { isCostOrganization } from "@/utils/orgTree";
import type { EmployeeEditData } from "@/components/employees/EmployeeEditRow";
import type { Employee } from "@/types/employee";
import { toast } from "sonner";

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

export default function EmployeesPage() {
  const { user: currentUser, isAdmin, canReview } = useAuthStore();
  const navigate = useNavigate();

  // Redirect users without management access away
  useEffect(() => {
    if (!isAdmin && !canReview) navigate("/timesheet", { replace: true });
  }, [isAdmin, canReview, navigate]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<EmployeeEditData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    name: string;
  } | null>(null);

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
    (emp: Employee) =>
      isAdmin || (!!emp.org_id && managedOrgIds.has(Number(emp.org_id))),
    [isAdmin, managedOrgIds],
  );

  const visibleOrgIds = useMemo(() => {
    if (isAdmin) return new Set(orgs.map((org) => org.id));
    return managedOrgIds;
  }, [isAdmin, orgs, managedOrgIds]);

  const visibleEmployees = useMemo(
    () => employees.filter((emp) => isAdmin || canEditEmployee(emp)),
    [employees, isAdmin, canEditEmployee],
  );

  const visibleOrgs = useMemo(
    () => orgs.filter((org) => isAdmin || visibleOrgIds.has(org.id)),
    [orgs, isAdmin, visibleOrgIds],
  );

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
      isCostOrganization(orgs, Number(editData.orgId)) &&
      !editData.costSpecialty
    ) {
      toast.error("造价/成本部门员工需要选择土建或机电岗位");
      return;
    }

    const payload: Record<string, unknown> = {
      id: editData.id || null,
      employeeNo: editData.employeeNo,
      name: editData.name.trim(),
      role: editData.role,
      orgId: editData.orgId ? Number(editData.orgId) : null,
      positionName: editData.positionName,
      costSpecialty: editData.costSpecialty || null,
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

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3 max-[640px]:flex-col">
        <div>
          <strong className="block text-sm text-foreground">系统管理</strong>
          <p className="mt-1 text-xs text-muted-foreground">
            维护员工账号、组织关系与系统基础配置
          </p>
        </div>
        <Badge
          variant="outline"
          className="h-7 rounded-pill border-border bg-white px-3 text-xs font-bold text-muted-foreground"
        >
          版本 {APP_VERSION}
        </Badge>
      </div>

      <div className="grid grid-cols-[1.45fr_0.55fr] gap-4 max-[900px]:grid-cols-1">
        <div>
          <div className="flex items-center justify-between mb-3">
            <strong className="text-sm">员工列表</strong>
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
                className={isAdmin ? "" : "hidden"}
              >
                <Trash2 className="size-3.5 mr-1" />
                删除员工
              </Button>
              <Button size="sm" onClick={handleNew} className={isAdmin ? "" : "hidden"}>
                <Plus className="size-3.5 mr-1" />
                新增员工
              </Button>
            </div>
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
              employees={visibleEmployees}
              orgs={visibleOrgs}
              selectedId={selectedId}
              editingId={editingId}
              editData={editData}
              onSelect={setSelectedId}
              onEdit={handleEdit}
              canEditEmployee={canEditEmployee}
              canEditRole={isAdmin}
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
          canManage={isAdmin}
          visibleOrgIds={visibleOrgIds}
        />
      </div>

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
