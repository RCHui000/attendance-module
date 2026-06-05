import { useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/utils/dates";
import { roleText } from "@/lib/constants";
import { EmployeeEditRow, type EmployeeEditData } from "./EmployeeEditRow";
import type { Employee, Organization } from "@/types/employee";
import { Pencil } from "lucide-react";

interface EmployeeTableProps {
  employees: Employee[];
  orgs: Organization[];
  selectedId: number | null;
  editingId: number | null;
  editData: EmployeeEditData | null;
  onSelect: (id: number | null) => void;
  onEdit: (id: number) => void;
  canEditEmployee?: (employee: Employee) => boolean;
  canEditRole?: boolean;
  onEditChange: (data: Partial<EmployeeEditData>) => void;
  onSave: () => void;
  onCancelEdit: () => void;
}

function calculateTenure(hireDate: string): string {
  const start = new Date(hireDate);
  const now = new Date();
  const total = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (total < 12) return `${total}个月`;
  return `${Math.floor(total / 12)}年`;
}

export function EmployeeTable({
  employees,
  orgs,
  selectedId,
  editingId,
  editData,
  onSelect,
  onEdit,
  canEditEmployee = () => true,
  canEditRole = true,
  onEditChange,
  onSave,
  onCancelEdit,
}: EmployeeTableProps) {
  const handleRowClick = useCallback(
    (id: number) => {
      if (editingId != null) return;
      onSelect(selectedId === id ? null : id);
    },
    [selectedId, editingId, onSelect],
  );

  return (
    <div className="rounded-lg border border-border shadow-app overflow-hidden">
      <div className="overflow-auto max-h-[65vh]">
        <Table>
          <TableHeader className="sticky top-0 bg-table-header z-10">
            <TableRow>
              <TableHead className="text-xs font-bold w-[60px] sticky left-0 bg-table-header z-20">
                操作
              </TableHead>
              <TableHead className="text-xs font-bold">编号</TableHead>
              <TableHead className="text-xs font-bold">姓名</TableHead>
              <TableHead className="text-xs font-bold">权限</TableHead>
              <TableHead className="text-xs font-bold">部门</TableHead>
              <TableHead className="text-xs font-bold">岗位</TableHead>
              <TableHead className="text-xs font-bold">合同</TableHead>
              <TableHead className="text-xs font-bold text-right">薪酬</TableHead>
              <TableHead className="text-xs font-bold">聘用期</TableHead>
              <TableHead className="text-xs font-bold">工龄</TableHead>
              <TableHead className="text-xs font-bold">直属领导</TableHead>
              <TableHead className="text-xs font-bold">状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* New row */}
            {editingId === 0 && editData && (
              <EmployeeEditRow
                item={null}
                data={editData}
                orgs={orgs}
                employees={employees}
                isNew
                canEditRole={canEditRole}
                onChange={onEditChange}
                onSave={onSave}
                onCancel={onCancelEdit}
              />
            )}

            {employees.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="text-center text-muted-foreground text-sm py-8">
                  暂无员工
                </TableCell>
              </TableRow>
            )}

            {employees.map((emp) => {
              if (editingId === emp.id && editData) {
                return (
                  <EmployeeEditRow
                    key={emp.id}
                    item={emp}
                    data={editData}
                    orgs={orgs}
                    employees={employees}
                    isNew={false}
                    canEditRole={canEditRole}
                    onChange={onEditChange}
                    onSave={onSave}
                    onCancel={onCancelEdit}
                  />
                );
              }

              // Use org_name as the department display
              const deptDisplay =
                emp.org_name || emp.department || "未分配部门";
              const editable = canEditEmployee(emp);

              return (
                <TableRow
                  key={emp.id}
                  className={cn(
                    "hover:bg-row-hover transition-colors cursor-pointer",
                    selectedId === emp.id && "bg-row-selected",
                  )}
                  onClick={() => handleRowClick(emp.id)}
                >
                  <TableCell
                    className="p-1.5 sticky left-0 bg-white z-[5]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={!editable}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!editable) return;
                        onEdit(emp.id);
                      }}
                    >
                      <Pencil className="size-3 mr-1" />
                      编辑
                    </Button>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {emp.employee_no || "—"}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {emp.name}
                  </TableCell>
                  <TableCell className="text-sm">
                    {roleText[emp.role] || emp.role || "员工"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {deptDisplay}
                  </TableCell>
                  <TableCell className="text-sm">
                    {emp.position_name || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {emp.contract_type === "service" ? "劳务合同" : "劳动合同"}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    {formatMoney(
                      emp.contract_type === "service"
                        ? emp.daily_wage
                        : emp.monthly_salary,
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {emp.hire_date ? `${emp.hire_date} 起` : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-right tabular-nums">
                    {emp.hire_date ? calculateTenure(emp.hire_date) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {emp.manager_name || "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-bold",
                        emp.status === "active"
                          ? "bg-[#dcfce7] text-success"
                          : "bg-[#f2f4f7] text-[#344054]",
                      )}
                    >
                      {emp.status === "active" ? "在职" : "离职"}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
