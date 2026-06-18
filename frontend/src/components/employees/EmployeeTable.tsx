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
import type { Employee } from "@/types/employee";
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, RotateCcw } from "lucide-react";

const costSpecialtyText: Record<string, string> = {
  civil: "土建",
  mep: "机电",
};

interface EmployeeTableProps {
  employees: Employee[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onEdit: (id: number) => void;
  onReactivate?: (id: number) => void;
  canEditEmployee?: (employee: Employee) => boolean;
  sortKey: EmployeeSortKey | null;
  sortDirection: SortDirection;
  onSort: (key: EmployeeSortKey) => void;
}

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

function calculateTenure(hireDate: string): string {
  const start = new Date(hireDate);
  const now = new Date();
  const total = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (total < 12) return `${Math.max(total, 0)}个月`;
  return `${Math.floor(total / 12)}年`;
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) return <ArrowUpDown className="size-3 text-muted-foreground/60" />;
  if (direction === "asc") return <ArrowUp className="size-3 text-primary" />;
  return <ArrowDown className="size-3 text-primary" />;
}

function SortableHead({
  label,
  sortId,
  sortKey,
  sortDirection,
  onSort,
  className,
}: {
  label: string;
  sortId: EmployeeSortKey;
  sortKey: EmployeeSortKey | null;
  sortDirection: SortDirection;
  onSort: (key: EmployeeSortKey) => void;
  className?: string;
}) {
  const active = sortKey === sortId;
  return (
    <TableHead className={cn("text-xs font-bold", className)}>
      <button
        type="button"
        className={cn(
          "flex h-full w-full items-center gap-1 text-left transition-colors hover:text-primary",
          className?.includes("text-right") && "justify-end",
        )}
        onClick={() => onSort(sortId)}
        title="点击切换排序：升序 / 降序 / 取消"
      >
        <span>{label}</span>
        <SortIcon active={active} direction={sortDirection} />
      </button>
    </TableHead>
  );
}

export function EmployeeTable({
  employees,
  selectedId,
  onSelect,
  onEdit,
  onReactivate,
  canEditEmployee = () => true,
  sortKey,
  sortDirection,
  onSort,
}: EmployeeTableProps) {
  const handleRowClick = useCallback(
    (id: number) => {
      onSelect(selectedId === id ? null : id);
    },
    [selectedId, onSelect],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border shadow-app">
      <div className="max-h-[65vh] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-table-header">
            <TableRow>
              <TableHead className="sticky left-0 z-20 w-[92px] bg-table-header text-xs font-bold">
                操作
              </TableHead>
              <SortableHead label="编号" sortId="employeeNo" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />
              <SortableHead label="姓名" sortId="name" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />
              <SortableHead label="权限" sortId="role" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />
              <SortableHead label="部门" sortId="department" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />
              <SortableHead label="岗位" sortId="position" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />
              <SortableHead label="合同" sortId="contract" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />
              <SortableHead label="薪酬" sortId="salary" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} className="text-right" />
              <SortableHead label="聘用期" sortId="hireDate" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />
              <SortableHead label="工龄" sortId="tenure" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />
              <SortableHead label="状态" sortId="status" sortKey={sortKey} sortDirection={sortDirection} onSort={onSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  暂无人员
                </TableCell>
              </TableRow>
            )}

            {employees.map((emp) => {
              const deptDisplay = emp.org_name || emp.department || "未分配部门";
              const editable = canEditEmployee(emp);
              const terminated = String(emp.status || "").toLowerCase() === "terminated";

              return (
                <TableRow
                  key={emp.id}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-row-hover",
                    selectedId === emp.id && "bg-row-selected",
                  )}
                  onClick={() => handleRowClick(emp.id)}
                >
                  <TableCell
                    className="sticky left-0 z-[5] bg-white p-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size={terminated && onReactivate ? "sm" : "icon-sm"}
                      variant="outline"
                      className={cn(
                        "h-7 rounded-full text-xs",
                        !terminated && "w-9",
                        terminated && onReactivate && "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                      )}
                      disabled={!editable}
                      aria-label={terminated && onReactivate ? "重新启用员工" : "编辑员工"}
                      title={terminated && onReactivate ? "重新启用" : "编辑"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!editable) return;
                        if (terminated && onReactivate) {
                          onReactivate(emp.id);
                          return;
                        }
                        onEdit(emp.id);
                      }}
                    >
                      {terminated && onReactivate ? (
                        <RotateCcw className="mr-1 size-3" />
                      ) : (
                        <Pencil className="size-3.5" />
                      )}
                      {terminated && onReactivate ? "重新启用" : null}
                    </Button>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {emp.employee_no || "-"}
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
                    <div className="flex flex-wrap items-center gap-1">
                      <span>{emp.position_name || "-"}</span>
                      {emp.cost_specialty && (
                        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                          {costSpecialtyText[emp.cost_specialty] || emp.cost_specialty}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {emp.contract_type === "service" ? "劳务合同" : "劳动合同"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatMoney(
                      emp.contract_type === "service"
                        ? emp.daily_wage
                        : emp.monthly_salary,
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {emp.hire_date ? `${emp.hire_date} 起` : "-"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {emp.hire_date ? calculateTenure(emp.hire_date) : "-"}
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
