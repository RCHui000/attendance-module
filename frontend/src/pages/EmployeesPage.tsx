import { useState, useCallback } from "react";
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
import { RefreshCw, Plus, Trash2 } from "lucide-react";
import { EmployeeTable } from "@/components/employees/EmployeeTable";
import { OrganizationPanel } from "@/components/employees/OrganizationPanel";
import { ReminderFloat } from "@/components/employees/ReminderFloat";
import { useAuthStore } from "@/stores/authStore";
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
  contractType: "labor",
  monthlySalary: "",
  dailyWage: "",
  hireDate: new Date().toISOString().slice(0, 10),
  contractMonths: "12",
  managerUserId: "",
  status: "active",
};

export default function EmployeesPage() {
  const { user: currentUser } = useAuthStore();
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

  const initEditData = useCallback(
    (emp: Employee): EmployeeEditData => ({
      id: emp.id,
      employeeNo: emp.employee_no || "",
      name: emp.name || "",
      role: emp.role || "employee",
      orgId: emp.org_id ? String(emp.org_id) : "",
      positionName: emp.position_name || "",
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
      const emp = employees.find((e) => e.id === id);
      if (!emp) return;
      setSelectedId(id);
      setEditingId(id);
      setEditData(initEditData(emp));
    },
    [employees, initEditData],
  );

  const handleNew = useCallback(() => {
    const orgId = orgs.find((o) => o.org_type !== "company")?.id;
    setSelectedId(null);
    setEditingId(0);
    setEditData({
      ...EMPTY_EDIT_DATA,
      orgId: orgId ? String(orgId) : "",
    });
  }, [orgs]);

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

    const payload: Record<string, unknown> = {
      id: editData.id || null,
      employeeNo: editData.employeeNo,
      name: editData.name.trim(),
      role: editData.role,
      orgId: editData.orgId ? Number(editData.orgId) : null,
      positionName: editData.positionName,
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
      await saveEmployee.mutateAsync(payload);
      toast.success("员工信息已保存");
      setEditingId(null);
      setEditData(null);
      setSelectedId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    }
  }, [editData, saveEmployee]);

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
    const emp = employees.find((e) => e.id === selectedId);
    if (!emp) {
      toast.error("选中的人员不存在，请刷新后重试");
      return;
    }
    if (emp.id === currentUser?.id) {
      toast.error("不能删除当前登录账号");
      return;
    }
    setDeleteTarget({ id: emp.id, name: emp.name || String(emp.id) });
  }, [selectedId, employees, currentUser]);

  const deleteDisabled = !selectedId || editingId != null;

  return (
    <div>
      <div className="grid grid-cols-[1.45fr_0.55fr] gap-4 max-[900px]:grid-cols-1">
        <div>
          <div className="flex items-center justify-between mb-3">
            <strong className="text-sm">员工列表</strong>
            <div className="flex gap-1">
              <ReminderFloat employees={employees} />
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="size-3.5 mr-1" />
                刷新
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteDisabled}
                onClick={handleDelete}
              >
                <Trash2 className="size-3.5 mr-1" />
                删除员工
              </Button>
              <Button size="sm" onClick={handleNew}>
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
              employees={employees}
              orgs={orgs}
              selectedId={selectedId}
              editingId={editingId}
              editData={editData}
              onSelect={setSelectedId}
              onEdit={handleEdit}
              onEditChange={(update) =>
                setEditData((prev) => (prev ? { ...prev, ...update } : prev))
              }
              onSave={handleSave}
              onCancelEdit={handleCancelEdit}
            />
          )}
        </div>

        <OrganizationPanel employees={employees} />
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
